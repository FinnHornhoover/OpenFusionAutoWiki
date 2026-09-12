import { Link, Route, Routes, useMatch } from 'react-router-dom';
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

export default function App() {
  const isWorldMap = useMatch('/:build/map');
  return (
    <div className={isWorldMap ? 'app app-world-map' : 'app'}>
      <header className="site-header">
        <Link to="/" className="brand"><img src="/assets/FusionFallWiki_simple_tiny.png" alt="FusionFall Wiki Logo" className="logo" width="162" height="64" /></Link>
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
        {' · '}
        <span>Contribute to <a href="https://github.com/FinnHornhoover/OpenFusionAutoWiki" target="_blank" rel="noreferrer">OpenFusionAutoWiki</a></span>
      </footer>
    </div>
  );
}
