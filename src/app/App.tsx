import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useActivation } from './useActivation';
import { Splash } from './ui';
import { NativeBackButton } from './NativeBackButton';
import { ActivateScreen } from '@/tablet/ActivateScreen';
import { OwnerGate } from '@/owner/OwnerGate';
import { TabletHome } from '@/tablet/TabletHome';
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
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/activate" element={<ActivateScreen />} />
        <Route path="/owner/*" element={<OwnerGate />} />
        <Route path="*" element={<TabletGate />} />
      </Routes>
      <NativeBackButton />
    </BrowserRouter>
  );
}
