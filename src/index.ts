import { getInput, setFailed, setOutput } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import type { PushEvent } from "@octokit/webhooks-types";
import ensureError from "ensure-error";
import { template } from "lodash-es";
import { filter } from "minimatch";
import { sync } from "./sync.js";

const run = async () => {
  try {
    const [getBody, getHead, _getLabels, getTitle] = [
      "body_template",
      "head_template",
      "labels_template",
      "title_template",
    ].map((name) => template(getInput(name)));

    const getLabels = ({
      base,
      head,
    }: Readonly<{ base: string; head: string }>): string[] => {
      const json = _getLabels({ base, head });
      try {
        return JSON.parse(json) as string[];
      } catch (_error: unknown) {
        const error = ensureError(_error);
        throw new Error(`Could not parse labels from invalid JSON: ${json}.`, {
          cause: error,
        });
      }
    };

    const branchesPattern = getInput("branches_pattern");
    const filterBranches = branchesPattern
      ? filter(branchesPattern)
      : undefined;

    const token = getInput("github_token", { required: true });
    const octokit = getOctokit(token);

    if (context.payload.action !== "push") {
      throw new Error(`Unsupported event action: ${context.payload.action}.`);
    }

    const payload = context.payload as PushEvent;

    if (payload.deleted) {
      throw new Error("Expected to not be triggered on ref deletion.");
    }

    const createdPullRequestBaseBranchToNumber = await sync({
      filterBranches,
      getBody,
      getHead,
      getLabels,
      getTitle,
      octokit,
      payload,
    });
    setOutput(
      "created_pull_requests",
      JSON.stringify(createdPullRequestBaseBranchToNumber),
    );
  } catch (_error: unknown) {
    const error = ensureError(_error);
    setFailed(error);
  }
};

void run();
