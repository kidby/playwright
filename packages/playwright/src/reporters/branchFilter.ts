export type BranchPattern = string | RegExp;
export type BranchFilterOptions = {
  branches?: BranchPattern | BranchPattern[];
  excludeBranches?: BranchPattern | BranchPattern[];
};

export function currentBranch(): string | undefined {
  const v = process.env.CIRCLE_BRANCH
    || process.env.GITHUB_REF_NAME
    || process.env.CI_COMMIT_REF_NAME
    || process.env.BUILDKITE_BRANCH
    || process.env.BRANCH_NAME
    || process.env.BUILD_SOURCEBRANCHNAME;
  return v && v.length > 0 ? v : undefined;
}

function matches(branch: string, pattern: BranchPattern): boolean {
  return pattern instanceof RegExp ? pattern.test(branch) : pattern === branch;
}

function matchesAny(branch: string, patterns: BranchPattern | BranchPattern[]): boolean {
  const arr = Array.isArray(patterns) ? patterns : [patterns];
  return arr.some(p => matches(branch, p));
}

export function shouldRunForBranch(opts: BranchFilterOptions): boolean {
  const noFilter = !opts.branches && !opts.excludeBranches;
  if (noFilter)
    return true;
  const branch = currentBranch();
  if (!branch)
    return true;
  if (opts.excludeBranches && matchesAny(branch, opts.excludeBranches))
    return false;
  if (opts.branches && !matchesAny(branch, opts.branches))
    return false;
  return true;
}
