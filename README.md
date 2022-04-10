Sync-branches is a [JavaScript GitHub Action](https://help.github.com/en/articles/about-actions#javascript-actions) to merge a repository branch into other branches to keep them in sync.

# Usage

1. :electric_plug: Add this [.github/workflows/sync-branches.yml](.github/workflows/sync-branches.yml) to your repository.

2. :sparkles: That's it! When the action is run after a commit is pushed, PRs will be created (or updated) to merge the commit's branch into the configured ones.

_Note:_ To avoid successive sync PRs to run into conflicts, PRs created by this action should be merged with a merge commits (i.e. no squash or rebase merge).
