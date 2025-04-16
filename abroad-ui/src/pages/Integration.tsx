import React, { useState } from "react";
import Navbar from "../components/navbar";

export function Integration() {
  const [activeSection, setActiveSection] = useState<string>("integration");

  return (
    <div className="min-h-screen p-4 bg-gray-50">
      <Navbar activeSection={activeSection} setActiveSection={setActiveSection} />
      <IntegrationHome />
    </div>
  );
}

function IntegrationHome() {
  return (
    <div>
      <h1>Integration Page</h1>
      <p>Welcome to the integration page!</p>
    </div>
  );
}