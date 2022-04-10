import { group, info, error as logError } from "@actions/core";
import type { GitHub } from "@actions/github/lib/utils.js";
import type { PushEvent } from "@octokit/webhooks-types";
import ensureError from "ensure-error";

const refPrefix = "refs/heads/";

const syncOnce = async ({
  base,
  body,
  commitSha,
  head,
  labels,
  octokit,
  owner,
  repo,
  title,
}: Readonly<{
  base: string;
  body: string;
  commitSha: string;
  head: string;
  labels: readonly string[];
  octokit: InstanceType<typeof GitHub>;
  owner: string;
  repo: string;
  title: string;
}>): Promise<number> => {
  let number: number;
  let refCreated: boolean;

  const ref = `${refPrefix}${head}`;

  try {
    await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
      owner,
      ref,
      repo,
      sha: commitSha,
    });
    refCreated = true;
  } catch {
    info(
      `Could not create reference "${ref}"; assuming that it already exists.`,
    );
    refCreated = false;
  }

  if (refCreated) {
    ({
      data: { number },
    } = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
      base,
      body,
      head: ref,
      owner,
      repo,
      title,
    }));

    if (labels.length > 0) {
      await octokit.request(
        "PUT /repos/{owner}/{repo}/issues/{issue_number}/labels",
        {
          issue_number: number,
          labels: [...labels],
          owner,
          repo,
        },
      );
    }
  } else {
    const { data: pullRequests } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls",
      { base, head: `${owner}:${head}`, owner, repo },
    );

    if (pullRequests.length !== 1) {
      throw new Error(
        `Expected one and only one PR to match but matched with: ${pullRequests.map(
          ({ number }) => `#${number}`,
        )}.`,
      );
    }

    ({ number } = pullRequests[0]);

    try {
      await octokit.request("POST /repos/{owner}/{repo}/merges", {
        base: head,
        head: commitSha,
        owner,
        repo,
      });
    } catch (_error: unknown) {
      const error = ensureError(_error);
      logError(error);

      await octokit.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          body: `Could not update this syncing PR: failed to merge ${commitSha}.`,
          issue_number: number,
          owner,
          repo,
        },
      );
    }
  }

  return number;
};

type Props = Readonly<{
  base: string;
  head: string;
}>;

const sync = async ({
  filterBranches,
  getBody,
  getHead,
  getLabels,
  getTitle,
  octokit,
  payload: {
    after,
    ref,
    repository: {
      name: repo,
      owner: { login: owner },
    },
  },
}: {
  filterBranches?: (
    element: string,
    index: number,
    array: readonly string[],
  ) => boolean;
  getBody: (props: Props) => string;
  getHead: (props: Props) => string;
  getLabels: (props: Props) => string[];
  getTitle: (props: Props) => string;
  octokit: InstanceType<typeof GitHub>;
  payload: PushEvent;
}): Promise<{ [base: string]: number }> => {
  if (!ref.startsWith(refPrefix)) {
    throw new Error(
      `Expected ref to start with "${refPrefix}" but got "${ref}".`,
    );
  }

  const branchToSync = ref.slice(refPrefix.length);

  const branches = await octokit.paginate(
    "GET /repos/{owner}/{repo}/branches",
    { owner, repo },
  );

  const branchNames = branches.map(({ name }) => name);
  const baseBranches = (
    filterBranches
      ? branchNames.filter((element, index, array) =>
          filterBranches(element, index, array),
        )
      : branches
          .filter(({ protected: _protected }) => _protected)
          .map(({ name }) => name)
  ).filter((name) => name !== branchToSync);

  if (baseBranches.length === 0) {
    info("No branches to sync.");
    return {};
  }

  info(`Syncing branches with ${branchToSync}.`);

  const createdPullRequestBaseBranchToNumber: { [base: string]: number } = {};

  for (const base of baseBranches) {
    const body = getBody({
      base,
      head: branchToSync,
    });
    const head = getHead({ base, head: branchToSync });
    const labels = getLabels({
      base,
      head: branchToSync,
    });
    const title = getTitle({ base, head: branchToSync });

    // PRs are handled sequentially to avoid breaking GitHub's log grouping feature.
    // eslint-disable-next-line no-await-in-loop
    await group(`Syncing ${base} with ${branchToSync}.`, async () => {
      try {
        const {
          data: { files },
        } = await octokit.request(
          "GET /repos/{owner}/{repo}/compare/{base}...{head}",
          { base: branchToSync, head: base, owner, repo },
        );

        if (!files || files.length === 0) {
          info("The two branches have no differences, nothing to do.");
          return;
        }

        const syncingPullRequestNumber = await syncOnce({
          base,
          body,
          commitSha: after,
          head,
          labels,
          octokit,
          owner,
          repo,
          title,
        });
        createdPullRequestBaseBranchToNumber[base] = syncingPullRequestNumber;
        info(`PR #${syncingPullRequestNumber} has been created.`);
      } catch (_error: unknown) {
        const error = ensureError(_error);
        logError(error);
      }
    });
  }

  return createdPullRequestBaseBranchToNumber;
};

export { sync };
