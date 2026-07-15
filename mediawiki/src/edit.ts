export interface EditTarget {
  missing?: boolean;
  revisions?: Array<{ revid?: number }>;
}

export function buildEditParams(
  title: string,
  text: string,
  summary: string,
  token: string,
  remote: EditTarget,
) {
  const params: Record<string, string> = {
    action: "edit",
    title,
    text,
    summary,
    token,
    assert: "user",
    maxlag: "5",
  };
  if (remote.missing) {
    params.createonly = "1";
  } else {
    const revisionId = remote.revisions?.[0]?.revid;
    if (!revisionId) throw new Error("Missing base revision for " + title);
    params.baserevid = String(revisionId);
  }
  return params;
}

export const isEditConflict = (message: string) =>
  /^(editconflict|articleexists|pagedeleted):/.test(message);

export function mergeContinuedPage(previous: any, page: any) {
  const combined = { ...previous, ...page };
  if (!page.revisions && previous?.revisions) {
    combined.revisions = previous.revisions;
  }
  return combined;
}
