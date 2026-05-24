import { Link, Route, Routes } from 'react-router-dom';
import BuildSwitcher from './components/BuildSwitcher';
import QuickPicks from './components/QuickPicks';
import SearchBar from './components/SearchBar';
import Home from './pages/Home';
import BuildHome from './pages/BuildHome';
import EntityIndex from './pages/EntityIndex';
import EntityPage from './pages/EntityPage';
import NotFound from './pages/NotFound';

export default function App() {
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
