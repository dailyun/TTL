import { applyFeedback, execution } from "../execution/core.js";
import { createHash } from "node:crypto";
import webpush from "web-push";
import { ExternalApiError } from "../external-api/errors.js";
import { withCheckInState } from "./store.js";
import { checkInInputSchema, feedbackInputSchema, subscriptionSchema, type CheckIn, type CheckInInput, type Delivery, type Subscription } from "./schema.js";

export function pushConfiguration() {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY || "";
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY || "";
  const subject = process.env.WEB_PUSH_SUBJECT || "";
  return { configured: Boolean(publicKey && privateKey && /^(mailto:|https:\/\/)/.test(subject)), publicKey, privateKey, subject };
}

export async function subscribeDevice(value: unknown) {
  const subscription = subscriptionSchema.parse(value);
  const id = createHash("sha256").update(subscription.endpoint).digest("hex");
  return withCheckInState((state) => {
    const existing = state.devices.find((d) => d.id === id);
    if (existing) existing.subscription = subscription;
    else {
      if (state.devices.length >= 20) throw new ExternalApiError(409, "device_limit", "已达到设备数量上限。");
      state.devices.push({ id, subscription, createdAt: new Date().toISOString() });
    }
    return { id };
  });
}

export async function unsubscribeDevice(id: string) {
  return withCheckInState((state) => { state.devices = state.devices.filter((d) => d.id !== id); return { removed: true }; });
}

export async function createCheckIn(value: unknown, options: { test?: boolean; targetSubscriptionId?: string; now?: Date } = {}): Promise<CheckIn> {
  const input = checkInInputSchema.parse(value);
  return withCheckInState((state) => {
    if (options.targetSubscriptionId && !state.devices.some((d) => d.id === options.targetSubscriptionId)) {
      throw new ExternalApiError(404, "device_missing", "请先在此设备开启通知。");
    }
    const existing = state.checkIns.find((c) => c.id === input.id);
    if (existing) {
      const original = checkInInputSchema.parse(Object.fromEntries(Object.keys(checkInInputSchema.shape).map((key) => [key, existing[key as keyof CheckInInput]])));
      if (JSON.stringify(original) !== JSON.stringify(input) || existing.test !== Boolean(options.test) || existing.targetSubscriptionId !== options.targetSubscriptionId) {
        throw new ExternalApiError(409, "id_conflict", "此 ID 已用于另一项回顾。请读取当前内容后重试。");
      }
      return existing;
    }
    const timestamp = (options.now ?? new Date()).toISOString();
    const checkIn: CheckIn = { ...input, status: "pending", version: 1, test: Boolean(options.test), targetSubscriptionId: options.targetSubscriptionId, createdAt: timestamp, updatedAt: timestamp };
    state.checkIns.push(checkIn);
    return checkIn;
  });
}

export async function listCheckIns(id?: string) {
  return withCheckInState((state) => ({
    data: state.checkIns.filter((c) => !id || c.id === id).slice(-200).reverse().map((c) => ({ ...c,
      deliveries: state.deliveries.filter((d) => d.checkInId === c.id).map(({ status, attemptedAt, statusCode }) => ({ status, attemptedAt, statusCode }))
    }))
  }), false);
}

export async function updateCheckIn(id: string, version: number, change: { dueAt?: string; status?: "cancelled" }) {
  return withCheckInState((state) => {
    const item = state.checkIns.find((c) => c.id === id);
    if (!item) throw new ExternalApiError(404, "not_found", "回顾不存在。");
    if (item.version !== version) throw new ExternalApiError(412, "version_conflict", "回顾已变化，请刷新。");
    if (item.status !== "pending") throw new ExternalApiError(409, "not_pending", "已回答或已取消的回顾不能改期。");
    if (change.dueAt) item.dueAt = change.dueAt;
    if (change.status) item.status = change.status;
    item.version += 1;
    item.updatedAt = new Date().toISOString();
    return item;
  });
}

export async function answerCheckIn(id: string, value: unknown) {
  const input = feedbackInputSchema.parse(value);
  return withCheckInState((state) => {
    const item = state.checkIns.find((c) => c.id === id);
    if (!item) throw new ExternalApiError(404, "not_found", "回顾不存在。");
    const duplicate = state.feedback.find((f) => f.id === input.id);
    if (duplicate) {
      if (duplicate.checkInId !== id || duplicate.outcome !== input.outcome || duplicate.text !== input.text || duplicate.supersedesId !== input.supersedesId) {
        throw new ExternalApiError(409, "feedback_conflict", "反馈 ID 已用于不同内容。");
      }
      return duplicate;
    }
    if (item.status === "cancelled" || (item.status === "answered" && input.supersedesId !== item.feedback?.id) || (item.status === "pending" && input.supersedesId)) {
      throw new ExternalApiError(409, "not_pending", "回顾已变化；更正请引用最新反馈编号。");
    }
    const feedback = { ...input, sequence: ++state.sequence, checkInId: id, title: item.title, test: item.test,
      submittedAt: new Date().toISOString(), source: "owner_web" as const,
      goalTreeLink: item.goalTreeLink, itemId: item.itemId, occurrenceId: item.occurrenceId };
    item.feedback = feedback;
    item.status = "answered";
    item.version += 1;
    item.updatedAt = feedback.submittedAt;
    state.feedback.push(feedback);
    applyFeedback(state, feedback);
    return feedback;
  });
}

export async function feedbackFeed(after: number, limit: number, id?: string) {
  return withCheckInState((state) => {
    const eligible = state.feedback.filter((f) => f.sequence > after && (!id || f.id === id));
    const data = eligible.slice(0, limit);
    return { data, nextCursor: data.at(-1)?.sequence ?? after, hasMore: eligible.length > data.length };
  }, false);
}

type Sender = (subscription: Subscription, payload: string) => Promise<unknown>;
export async function dispatchCheckIns(options: { now?: Date; onlyId?: string; sender?: Sender } = {}) {
  const now = options.now ?? new Date();
  const config = pushConfiguration();
  if (!config.configured && !options.sender) throw new ExternalApiError(503, "push_not_configured", "服务端尚未配置 Web Push。");
  const sender: Sender = options.sender ?? ((subscription, payload) => webpush.sendNotification(subscription, payload, {
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey }, TTL: 3600, timeout: 10_000
  }));
  const claims = await withCheckInState((state) => {
    state.lastDispatchAt = now.toISOString();
    for (const d of state.deliveries) {
      if (d.status === "sending" && now.getTime() - Date.parse(d.attemptedAt) > 60_000) d.status = "unknown";
    }
    const result: Array<{ delivery: Delivery; subscription: Subscription }> = [];
    for (const item of state.checkIns) {
      if (item.suppressPush || (item.expiresAt && Date.parse(item.expiresAt) < now.getTime()) || (!item.test && !execution(state).preferences.notifications)) continue;
      if (item.status !== "pending" || Date.parse(item.dueAt) > now.getTime() || (options.onlyId && item.id !== options.onlyId)) continue;
      for (const device of state.devices) {
        if (item.targetSubscriptionId && item.targetSubscriptionId !== device.id) continue;
        const key = `${item.id}/${item.version}/${device.id}`;
        let delivery = state.deliveries.find((d) => d.id === key);
        if (delivery && !(delivery.status === "failed" && delivery.retryAt && Date.parse(delivery.retryAt) <= now.getTime() && delivery.attempts < 3)) continue;
        if (result.length >= 20) break;
        if (!delivery) {
          delivery = { id: key, checkInId: item.id, checkInVersion: item.version, subscriptionId: device.id, status: "sending", attemptedAt: now.toISOString(), attempts: 0 };
          state.deliveries.push(delivery);
        }
        delivery.status = "sending";
        delivery.attemptedAt = now.toISOString();
        delivery.attempts += 1;
        delete delivery.retryAt;
        result.push({ delivery: { ...delivery }, subscription: device.subscription });
      }
    }
    return result;
  });
  const results = await Promise.all(claims.map(async ({ delivery, subscription }) => {
    const item = await withCheckInState((state) => state.checkIns.find((c) => c.id === delivery.checkInId && c.version === delivery.checkInVersion && c.status === "pending"), false);
    let status: Delivery["status"] = "failed";
    let statusCode: number | undefined;
    if (item) {
      try {
        await sender(subscription, JSON.stringify({ title: item.test ? "TodoTodoList 测试提醒" : item.title,
          body: item.prompt.slice(0, 140), tag: item.id, url: item.kind ? `/today${item.kind === "evening" ? "#reviews" : ""}` : `/review?checkIn=${encodeURIComponent(item.id)}` }));
        status = "accepted";
      } catch (error) {
        statusCode = (error as { statusCode?: number }).statusCode;
        status = statusCode ? "failed" : "unknown";
      }
    }
    await withCheckInState((state) => {
      const current = state.deliveries.find((d) => d.id === delivery.id);
      if (current?.status === "sending") {
        current.status = status;
        current.statusCode = statusCode;
        if (statusCode === 429 || (statusCode && statusCode >= 500)) current.retryAt = new Date(now.getTime() + 300_000).toISOString();
      }
      if (statusCode === 404 || statusCode === 410) state.devices = state.devices.filter((d) => d.id !== delivery.subscriptionId);
    });
    return { checkInId: delivery.checkInId, status };
  }));
  return { processed: results.length, results };
}
