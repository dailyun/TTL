import micromatch from "micromatch";

export interface GitHubRepoConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  apiBaseUrl?: string;
}

export interface GitHubFileContent {
  path: string;
  sha: string;
  content: string;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
    readonly body: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

interface GitHubTreeResponse {
  tree: Array<{
    path: string;
    type: "blob" | "tree" | "commit";
  }>;
}

interface GitHubContentResponse {
  path: string;
  sha: string;
  content: string;
  encoding: string;
}

interface GitHubWriteFileResponse {
  content?: {
    sha?: string;
  };
}

export class GitHubContentsClient {
  private readonly apiBaseUrl: string;

  constructor(private readonly config: GitHubRepoConfig) {
    this.apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  }

  async listFiles(pattern: string): Promise<string[]> {
    const encodedBranch = encodeURIComponent(this.config.branch);
    const response = await this.request<GitHubTreeResponse>(
      `/repos/${this.config.owner}/${this.config.repo}/git/trees/${encodedBranch}?recursive=1`
    );

    const files = response.tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => entry.path);

    return micromatch(files, pattern).sort();
  }

  async readFile(filePath: string): Promise<GitHubFileContent> {
    const response = await this.request<GitHubContentResponse>(
      `/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(
        this.config.branch
      )}`
    );

    if (response.encoding !== "base64") {
      throw new Error(`Unsupported GitHub content encoding: ${response.encoding}`);
    }

    return {
      path: response.path,
      sha: response.sha,
      content: Buffer.from(response.content.replace(/\s/g, ""), "base64").toString("utf8")
    };
  }

  async writeFile(params: {
    filePath: string;
    content: string;
    sha?: string;
    message: string;
  }): Promise<{ sha?: string }> {
    const body: {
      branch: string;
      content: string;
      message: string;
      sha?: string;
    } = {
      message: params.message,
      content: Buffer.from(params.content, "utf8").toString("base64"),
      branch: this.config.branch
    };
    if (params.sha) {
      body.sha = params.sha;
    }

    const response = await this.request<GitHubWriteFileResponse>(
      `/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(params.filePath)}`,
      {
        method: "PUT",
        body: JSON.stringify(body)
      }
    );

    return {
      sha: response.content?.sha
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.config.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init?.headers
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new GitHubApiError(
        `GitHub API request failed: ${response.status} ${response.statusText} ${body}`,
        response.status,
        response.statusText,
        body
      );
    }

    return (await response.json()) as T;
  }
}

function encodePath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}
