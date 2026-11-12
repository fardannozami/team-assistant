/**
 * Webhook payload -> normalized activity (GIT-003..006, GIT-008).
 *
 * Attribution (GIT-007): `actorLogin` is always a login GitHub itself
 * authenticated for that action: the PR/issue/comment/review user, the
 * merger, the sender of a close, or a commit's `author.username` (GitHub only
 * sets it when the commit email belongs to a verified account). The pusher
 * and the committer are never credited with someone else's commits, and raw
 * commit names/emails are never used.
 */
export type NormalizedActivity = {
  type: string;
  externalId: string;
  actorLogin: string | null;
  title: string | null;
  url: string | null;
  occurredAt: Date;
  metadata: Record<string, unknown>;
};

type User = { login?: string; type?: string } | null | undefined;
type Payload = Record<string, any>;

function login(user: User) {
  if (!user?.login || user.type === "Bot" || user.login.endsWith("[bot]")) return null;
  return user.login;
}

function when(...candidates: (string | null | undefined)[]) {
  const value = candidates.find(Boolean);
  return value ? new Date(value) : new Date();
}

function firstLine(text: string | null | undefined, max = 200) {
  const line = (text ?? "").split("\n")[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function normalizeEvent(event: string, payload: Payload): NormalizedActivity[] {
  const repoId = payload.repository?.id;
  if (!repoId) return [];

  switch (event) {
    case "push": {
      if (payload.deleted || !Array.isArray(payload.commits)) return [];
      const branch = typeof payload.ref === "string" ? payload.ref.replace(/^refs\/heads\//, "") : null;
      return payload.commits.map((commit: Payload) => ({
        type: "commit",
        externalId: `commit:${repoId}:${commit.id}`,
        actorLogin: commit.author?.username && !String(commit.author.username).endsWith("[bot]") ? commit.author.username : null,
        title: firstLine(commit.message),
        url: commit.url ?? null,
        occurredAt: when(commit.timestamp),
        metadata: { sha: commit.id, branch, pusher: payload.pusher?.name ?? null },
      }));
    }

    case "pull_request": {
      const pr = payload.pull_request;
      if (!pr) return [];
      const base = `pr:${repoId}:${pr.number}`;
      const common = {
        title: `PR #${pr.number}: ${firstLine(pr.title)}`,
        url: pr.html_url ?? null,
        metadata: { number: pr.number, draft: !!pr.draft },
      };
      switch (payload.action) {
        case "opened":
          return [{ ...common, type: "pr_opened", externalId: `${base}:opened`, actorLogin: login(pr.user), occurredAt: when(pr.created_at) }];
        case "reopened":
          return [{ ...common, type: "pr_reopened", externalId: `${base}:reopened:${pr.updated_at}`, actorLogin: login(payload.sender), occurredAt: when(pr.updated_at) }];
        case "ready_for_review":
          return [{ ...common, type: "pr_ready", externalId: `${base}:ready:${pr.updated_at}`, actorLogin: login(payload.sender), occurredAt: when(pr.updated_at) }];
        case "synchronize":
          return [{ ...common, type: "pr_updated", externalId: `${base}:sync:${payload.after}`, actorLogin: login(payload.sender), occurredAt: when(pr.updated_at) }];
        case "closed":
          return pr.merged
            ? [{ ...common, type: "pr_merged", externalId: `${base}:merged`, actorLogin: login(pr.merged_by ?? payload.sender), occurredAt: when(pr.merged_at) }]
            : [{ ...common, type: "pr_closed", externalId: `${base}:closed:${pr.closed_at}`, actorLogin: login(payload.sender), occurredAt: when(pr.closed_at) }];
        default:
          return [];
      }
    }

    case "pull_request_review": {
      const { review, pull_request: pr } = payload;
      if (payload.action !== "submitted" || !review || !pr) return [];
      return [
        {
          type: "pr_reviewed",
          externalId: `review:${repoId}:${review.id}`,
          actorLogin: login(review.user),
          title: `PR #${pr.number}: ${firstLine(pr.title)}`,
          url: review.html_url ?? pr.html_url ?? null,
          occurredAt: when(review.submitted_at),
          metadata: { number: pr.number, state: String(review.state ?? "").toLowerCase() },
        },
      ];
    }

    case "issues": {
      const issue = payload.issue;
      if (!issue) return [];
      const base = `issue:${repoId}:${issue.number}`;
      const common = {
        title: `Issue #${issue.number}: ${firstLine(issue.title)}`,
        url: issue.html_url ?? null,
        metadata: { number: issue.number },
      };
      switch (payload.action) {
        case "opened":
          return [{ ...common, type: "issue_opened", externalId: `${base}:opened`, actorLogin: login(issue.user), occurredAt: when(issue.created_at) }];
        case "closed":
          return [{ ...common, type: "issue_closed", externalId: `${base}:closed:${issue.closed_at}`, actorLogin: login(payload.sender), occurredAt: when(issue.closed_at) }];
        case "reopened":
          return [{ ...common, type: "issue_reopened", externalId: `${base}:reopened:${issue.updated_at}`, actorLogin: login(payload.sender), occurredAt: when(issue.updated_at) }];
        default:
          return [];
      }
    }

    case "issue_comment": {
      const { issue, comment } = payload;
      if (payload.action !== "created" || !issue || !comment) return [];
      const onPr = !!issue.pull_request;
      return [
        {
          type: onPr ? "pr_commented" : "issue_commented",
          externalId: `comment:${repoId}:${comment.id}`,
          actorLogin: login(comment.user),
          title: `${onPr ? "PR" : "Issue"} #${issue.number}: ${firstLine(issue.title)}`,
          url: comment.html_url ?? null,
          occurredAt: when(comment.created_at),
          metadata: { number: issue.number },
        },
      ];
    }

    default:
      return [];
  }
}
