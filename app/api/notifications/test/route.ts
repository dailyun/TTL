import { z } from "zod";
import { assertCheckInOwner, readCheckInJson } from "../../../../src/check-ins/auth.js";
import { createCheckIn, pushConfiguration } from "../../../../src/check-ins/service.js";
import { idSchema } from "../../../../src/check-ins/schema.js";
import { ExternalApiError } from "../../../../src/external-api/errors.js";
import { externalApiError, externalApiJson } from "../../../../src/external-api/http.js";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await assertCheckInOwner(request, true);
    if (!pushConfiguration().configured) throw new ExternalApiError(503, "push_not_configured", "服务端尚未配置 Web Push。");
    const input = z.object({ id: idSchema, subscriptionId: z.string().regex(/^[a-f0-9]{64}$/), dueAt: z.string().datetime({ offset: true }) }).strict().parse(await readCheckInJson(request));
    if (Math.abs(Date.parse(input.dueAt) - Date.now()) > 300_000) throw new ExternalApiError(400, "invalid_time", "测试时间应在当前时间前后五分钟内。");
    const data = await createCheckIn({ id: input.id, title: "一次推送与反馈测试", prompt: "这是一条测试提醒。点开后选择结果并补充一句话。", dueAt: input.dueAt }, { test: true, targetSubscriptionId: input.subscriptionId });
    return externalApiJson(request, { data }, { status: 201 });
  } catch (error) { return externalApiError(request, error); }
}
