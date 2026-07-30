import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { parseHash } from "./parse-hash";
import { RouterContext, type RouterValue } from "./router-context";
import type { Route } from "./routes";

function resolveInitialRoute(): Route {
  const result = parseHash(window.location.hash);
  if (result.kind === "redirect") {
    window.location.replace(result.hash);
    const resolved = parseHash(result.hash);
    return resolved.kind === "route" ? resolved.route : { page: "home" };
  }
  return result.route;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(resolveInitialRoute);
  const prevPageRef = useRef(route.page);

  const navigate = useCallback(
    (hash: string, options?: { replace?: boolean }) => {
      if (options?.replace) {
        window.history.replaceState(null, "", hash);
      } else {
        window.history.pushState(null, "", hash);
      }
      const result = parseHash(hash);
      if (result.kind === "redirect") {
        window.location.replace(result.hash);
        const resolved = parseHash(result.hash);
        if (resolved.kind === "route") setRoute(resolved.route);
      } else {
        setRoute(result.route);
      }
    },
    [],
  );

  const back = useCallback(() => {
    window.history.back();
  }, []);

  useEffect(() => {
    function onHashChange() {
      const result = parseHash(window.location.hash);
      if (result.kind === "redirect") {
        window.location.replace(result.hash);
        const resolved = parseHash(result.hash);
        if (resolved.kind === "route") setRoute(resolved.route);
      } else {
        setRoute(result.route);
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (prevPageRef.current !== route.page) {
      prevPageRef.current = route.page;
      window.scrollTo(0, 0);
    }
  }, [route.page]);

  const value: RouterValue = { route, navigate, back };

  return (
    <RouterContext value={value}>
      {children}
    </RouterContext>
  );
}
