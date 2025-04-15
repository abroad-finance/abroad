import React from "react";
import { useNavigate } from "react-router-dom"; // Import useNavigate
import {
  Home as HomeIcon,
  Send as SendIcon,
  Banknote as BankIcon,
  Users as UsersIcon,
  ShieldAlert as SecurityIcon,
  Cog as CogIcon,
  HelpCircle as HelpIcon,
} from "lucide-react";

const navLinks = [
  { label: "Dashboard", icon: HomeIcon, section: "dashboard", path: "/dashboard" },
  { label: "Send Payment", icon: SendIcon, section: "send" },
  { label: "Transactions", icon: BankIcon, section: "transactions" },
  { label: "Recipients", icon: UsersIcon, section: "recipients", path: "/recipients" },
  { label: "Security", icon: SecurityIcon, section: "security" },
  { label: "API & Integrations", icon: CogIcon, section: "api", path: "/integrations" },
  { label: "Help & Support", icon: HelpIcon, section: "help" },
];

export default function Topbar({ activeSection, setActiveSection }) {
  const navigate = useNavigate(); // Initialize useNavigate

  return (
    <header className="w-full bg-white border-b border-gray-200 shadow-sm">
      <div className="flex justify-center py-4">
        <img
          src="https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/67bdb92323f0bb399db3754c_abroad-logo.svg"
          alt="Abroad Logo"
          className="h-8"
        />
      </div>
      <div className="max-w-7xl mx-auto flex items-center justify-center px-4 py-2">
        <nav className="flex gap-6">
          {navLinks
            .filter(
              (link) =>
                link.section !== "send" &&
                link.section !== "transactions" &&
                link.section !== "security"
            )
            .map((link) => {
              const Icon = link.icon;

              // Check if the link is "Help & Support"
              if (link.section === "help") {
                return (
                  <a
                    key={link.section}
                    href="https://discord.gg/YqWdSxAy5B"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm font-medium transition-colors text-gray-600 hover:text-green-700"
                  >
                    <Icon className="w-4 h-4" />
                    {link.label}
                  </a>
                );
              }

              // Handle navigation for other links
              return (
                <button
                  key={link.section}
                  onClick={() => {
                    if (link.path) {
                      navigate(link.path); // Navigate to the specified path
                    }
                    if (typeof setActiveSection === "function") {
                      setActiveSection(link.section);
                    }
                  }}
                  className={`flex items-center gap-1 text-sm font-medium transition-colors ${
                    activeSection === link.section
                      ? "text-green-700"
                      : "text-gray-600 hover:text-green-700"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </button>
              );
            })}
        </nav>
      </div>
    </header>
  );
}
