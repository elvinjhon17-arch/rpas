import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Shell from './pages/Shell.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Appraisal from './pages/Appraisal.jsx';
import Profile from './pages/Profile.jsx';
import Employees from './pages/admin/Employees.jsx';
import TaskSetup from './pages/admin/TaskSetup.jsx';
import Factors from './pages/admin/Factors.jsx';
import Periods from './pages/admin/Periods.jsx';
import Submissions from './pages/admin/Submissions.jsx';
import Settings from './pages/admin/Settings.jsx';

function Protected({ children, admin }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-page">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function Home() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <Navigate to="/admin/submissions" replace /> : <Dashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <Protected>
                <Shell />
              </Protected>
            }
          >
            <Route path="/" element={<Home />} />
            <Route path="/appraisal" element={<Appraisal />} />
            <Route path="/rate/:raterType/:userId" element={<Appraisal />} />
            <Route path="/profile" element={<Profile />} />
            <Route
              path="/admin/employees"
              element={
                <Protected admin>
                  <Employees />
                </Protected>
              }
            />
            <Route
              path="/admin/tasks"
              element={
                <Protected admin>
                  <TaskSetup />
                </Protected>
              }
            />
            <Route
              path="/admin/factors"
              element={
                <Protected admin>
                  <Factors />
                </Protected>
              }
            />
            <Route
              path="/admin/periods"
              element={
                <Protected admin>
                  <Periods />
                </Protected>
              }
            />
            <Route
              path="/admin/submissions"
              element={
                <Protected admin>
                  <Submissions />
                </Protected>
              }
            />
            <Route
              path="/admin/settings"
              element={
                <Protected admin>
                  <Settings />
                </Protected>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
