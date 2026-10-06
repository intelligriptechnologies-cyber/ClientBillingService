# Issue tracker: GitHub

Issues and specifications for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --comments`, including labels.
- **List issues**: `gh issue list --state open` with appropriate labels and state filters.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; `gh` does this automatically inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

- **Map**: a single issue labelled `wayfinder:map`.
- **Child ticket**: an issue linked as a GitHub sub-issue with `gh issue create --parent <parent> ...`.
- **Blocking**: GitHub native dependencies. Add a blocker with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
- **Claim**: `gh issue edit <number> --add-assignee @me`.
- **Resolve**: add a resolution comment, close the issue, and update the map's Decisions so far with a context pointer.
