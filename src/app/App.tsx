import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useActivation } from './useActivation';
import { ActivateScreen } from '@/tablet/ActivateScreen';
import { OwnerHome } from '@/owner/OwnerHome';
import { TabletHome } from '@/tablet/TabletHome';

function Splash() {
  return <div data-testid="splash" className="flex h-full items-center justify-center text-stone-400">Đang tải…</div>;
}

/** Màn hình bán hàng chỉ dành cho tablet đã kích hoạt; mọi đường dẫn khác chuyển về kích hoạt. */
function TabletGate() {
  const act = useActivation();
  const loc = useLocation();
  if (act.status === 'loading') return <Splash />;
  if (act.status === 'none') return <Navigate to="/activate" replace state={{ from: loc.pathname }} />;
  return <TabletHome activation={act.activation} />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/activate" element={<ActivateScreen />} />
        <Route path="/owner/*" element={<OwnerHome />} />
        <Route path="*" element={<TabletGate />} />
      </Routes>
    </BrowserRouter>
  );
}
