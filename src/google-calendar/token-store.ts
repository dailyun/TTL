import fs from "node:fs";

interface StoredGoogleCalendarToken {
  refreshToken: string;
  updatedAt: string;
}

export function googleCalendarRefreshTokenPath(): string {
  return process.env.GOOGLE_REFRESH_TOKEN_PATH || ".tmp/google-calendar-token.json";
}

export function readStoredGoogleCalendarRefreshToken(): string | undefined {
  const tokenPath = googleCalendarRefreshTokenPath();
  try {
    const payload = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ tokenPath, "utf8")) as Partial<StoredGoogleCalendarToken>;
    return typeof payload.refreshToken === "string" && payload.refreshToken ? payload.refreshToken : undefined;
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

export function writeStoredGoogleCalendarRefreshToken(refreshToken: string, now = new Date()): void {
  const tokenPath = googleCalendarRefreshTokenPath();
  fs.mkdirSync(/* turbopackIgnore: true */ parentDirectory(tokenPath), { recursive: true });
  fs.writeFileSync(
    /* turbopackIgnore: true */ tokenPath,
    `${JSON.stringify(
      {
        refreshToken,
        updatedAt: now.toISOString()
      } satisfies StoredGoogleCalendarToken,
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  fs.chmodSync(/* turbopackIgnore: true */ tokenPath, 0o600);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function parentDirectory(filePath: string): string {
  const separatorIndex = filePath.lastIndexOf("/");
  return separatorIndex === -1 ? "." : filePath.slice(0, separatorIndex);
}
