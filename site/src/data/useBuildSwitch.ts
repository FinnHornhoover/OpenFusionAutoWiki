import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveBuildSwitchPath } from './resolveBuildSwitchPath';

export function useBuildSwitch(): (build: string) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const requestId = useRef(0);

  return useCallback((build: string) => {
    if (!build) return;
    const currentRequest = ++requestId.current;
    resolveBuildSwitchPath(build, location.pathname).then((path) => {
      if (requestId.current !== currentRequest) return;
      const switchedPath = path === location.pathname.replace(/^\/[^/]+/, `/${build}`)
        ? `${path}${location.search}${location.hash}`
        : path;
      navigate(switchedPath);
    });
  }, [location.hash, location.pathname, location.search, navigate]);
}
