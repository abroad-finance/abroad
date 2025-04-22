import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import BusinessDashboardLogin from "./pages/BusinessDashboardLogin";
import { Dashboard } from "./pages/Dashboard";
import Recipients from "./pages/Recipients";
import Integrations from "./pages/Integrations";

function App() {
 

  return (

    <Router>
      <Routes>
        <Route path="/" element={<BusinessDashboardLogin />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/recipients" element={<Recipients />} />
        <Route path="/integrations" element={<Integrations />} />
        {/* Add other routes here if needed */}
      </Routes>
    </Router>
  );
}

export default App;
