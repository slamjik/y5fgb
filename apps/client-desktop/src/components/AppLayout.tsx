import { Outlet, useLocation } from "react-router-dom";

import { Sidebar } from "@/components/Sidebar";

export function AppLayout() {
  const location = useLocation();

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <section className="page-transition" key={location.pathname}>
          <Outlet />
        </section>
      </main>
    </div>
  );
}

