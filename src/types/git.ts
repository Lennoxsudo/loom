/** Single line from `git_workspace_blame` (porcelain). */
export type GitBlameLine = {
  commitHash: string;
  author: string;
  /** author-time epoch seconds */
  date: string;
  lineNo: number;
  content: string;
};
