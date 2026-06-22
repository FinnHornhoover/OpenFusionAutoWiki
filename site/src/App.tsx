import { useLayoutEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import BuildSwitcher from './components/BuildSwitcher';
import QuickPicks from './components/QuickPicks';
import SearchBar from './components/SearchBar';
import Home from './pages/Home';
import BuildHome from './pages/BuildHome';
import EntityIndex from './pages/EntityIndex';
import EntityPage from './pages/EntityPage';
import NotFound from './pages/NotFound';
import PlayerStats from './pages/PlayerStats';
import WorldMap from './pages/WorldMap';

function useLayoutScrollWidth() {
  const location = useLocation();

  useLayoutEffect(() => {
    let frame = 0;
    const root = document.documentElement;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--page-overflow-width', '0px');
        const width = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0);
        const main = document.querySelector<HTMLElement>('.site-main');
        const mainStyle = main ? getComputedStyle(main) : null;
        const endPadding = mainStyle ? parseFloat(mainStyle.paddingInlineEnd || mainStyle.paddingRight) || 0 : 0;
        const overflowWidth = width > root.clientWidth + 1 ? width + endPadding : 0;
        root.style.setProperty('--page-overflow-width', Math.ceil(overflowWidth) + 'px');
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('toggle', update, true);

    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(root);
    if (document.body) resizeObserver.observe(document.body);

    const mutationObserver = new MutationObserver(update);
    if (document.body) {
      mutationObserver.observe(document.body, { attributes: true, childList: true, subtree: true });
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('toggle', update, true);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [location.pathname, location.search]);
}

export default function App() {
  useLayoutScrollWidth();
  return (
    <div className="app">
      <header className="site-header">
        <Link to="/" className="brand">FusionFall Wiki</Link>
        <QuickPicks />
        <BuildSwitcher />
        <SearchBar />
      </header>
      <main className="site-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/:build" element={<BuildHome />} />
          <Route path="/:build/map" element={<WorldMap />} />
          <Route path="/:build/player-stats" element={<PlayerStats />} />
          <Route path="/:build/:type" element={<EntityIndex />} />
          <Route path="/:build/:type/:id" element={<EntityPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="site-footer">
        <span>Data from <a href="https://github.com/FinnHornhoover/FFInfoPacks" target="_blank" rel="noreferrer">FFInfoPacks</a></span>
      </footer>
    </div>
  );
}
