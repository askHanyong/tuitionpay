// Pages a parent opens from a private link: no tutor-facing widgets there.
export const isParentFacingPath = (pathname) =>
  ["/pay/", "/parent/", "/book/"].some((p) => String(pathname).startsWith(p));
