import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import BusinessDashboardLogin from "./pages/BusinessDashboardLogin";
import { Dashboard } from "./pages/Dashboard";
import Recipients from "./pages/Recipients";
import Integrations from "./pages/Integrations";
import ProtectedRoute from "./components/ProtectedRoute"; // Import the ProtectedRoute component

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<BusinessDashboardLogin />} />
        {/* Wrap protected routes with ProtectedRoute */}
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/recipients" element={<Recipients />} />
          <Route path="/integrations" element={<Integrations />} />
        </Route>
        {/* Add other public routes here if needed */}
      </Routes>
    </Router>
  );
}

export default App;
