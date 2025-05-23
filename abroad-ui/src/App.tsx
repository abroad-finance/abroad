import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import BusinessDashboardLogin from "./pages/BusinessDashboardLogin";
import { Dashboard } from "./pages/Dashboard";
import Recipients from "./pages/Recipients";
import Integrations from "./pages/Integrations";
import ProtectedRoute from "./components/ProtectedRoute"; // Import the ProtectedRoute component
import { LanguageProvider } from './contexts/LanguageContext';
import { Settings } from "./pages/Settings";
import Pool from "./pages/Pool";
// Mobile pages
import Splash from "./pages/Mobile/Splash";
import Anchor from "./pages/Mobile/Anchor";


function App() {  
  return (
    <LanguageProvider>
      <Router>
        <Routes>
          <Route path="/" element={<BusinessDashboardLogin />} />
          {/* Wrap protected routes with ProtectedRoute */} 
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/Pool" element={<Pool />} />
            <Route path="/recipients" element={<Recipients />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          {/* Add other public routes here if needed */}
          <Route path="/mobile/splash" element={<Splash />} />
          <Route path="/mobile/anchor" element={<Anchor />} />
        </Routes>
      </Router>
    </LanguageProvider>
  );
}

export default App;
