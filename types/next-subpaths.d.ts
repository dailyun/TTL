declare module "next/navigation" {
  export function redirect(url: string): never;

  export function useRouter(): {
    refresh(): void;
    replace(url: string): void;
  };
}

declare module "next/server" {
  export class NextRequest extends Request {
    cookies: {
      get(name: string): { value: string } | undefined;
    };
    nextUrl: URL;
  }

  export class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit): NextResponse;
    static next(): NextResponse;
    static redirect(url: string | URL): NextResponse;
  }
}
