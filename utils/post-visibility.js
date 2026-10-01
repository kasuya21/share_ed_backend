// A published post is public only while its author's account is active.
export const PUBLIC_POST_WHERE = Object.freeze({
  post_status: "ACTIVE",
  author: { status: "ACTIVE" },
});
