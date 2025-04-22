import React, { useState, useEffect } from "react";
import { Card, CardContent } from "../components/card";
import { Button } from "../components/button";
import Navbar from "../components/navbar";
import { getBanks, type Bank, createPartnerUser, PaymentMethod, listPartnerUsers, PaginatedPartnerUsers } from "../api/apiClient";

export default function Recipients() {
  const [recipients, setRecipients] = useState([
    { name: "Juanito Perez", bank: "Nequi", bankNumber: "3102345674" },
    { name: "Emiliano Buendia", bank: "Bancolombia", bankNumber: "987654321" },
  ]);
  const [newRecipient, setNewRecipient] = useState({
    name: "",
    bank: "",
    bankNumber: "",
  });
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partnerUsers, setPartnerUsers] = useState<PaginatedPartnerUsers | null>(null);

  useEffect(() => {
    const fetchBanks = async () => {
      try {
        const response = await getBanks();
        setBanks(response.banks);
      } catch (error) {
        console.error("Failed to fetch banks:", error);
      } finally {
        setLoading(false);
      }
    };

    const fetchPartnerUsers = async () => {
      try {
        const users = await listPartnerUsers();
        setPartnerUsers(users);
      } catch (error) {
        console.error("Failed to fetch partner users:", error);
      }
    };

    fetchBanks();
    fetchPartnerUsers();
  }, []);

  const handleAddRecipient = async () => {
    setError(null);
    if (newRecipient.name && newRecipient.bank && newRecipient.bankNumber) {
      setAdding(true);
      try {
        // Find the selected bank object to get the bank code if needed
        const selectedBank = banks.find(b => b.bankName === newRecipient.bank);

        // Use MOVII as default payment method for demo, or let user select if needed
        const payment_method: PaymentMethod = "MOVII";

        // Call the API to create the partner user
        await createPartnerUser({
          account_number: newRecipient.bankNumber,
          bank: newRecipient.bank,
          payment_method,
          user_id: newRecipient.name, // Using name as user_id for demo; replace with real user_id in production
        });

        setRecipients([...recipients, newRecipient]);
        setNewRecipient({ name: "", bank: "", bankNumber: "" });

        // Refresh partner users list after adding
        const users = await listPartnerUsers();
        setPartnerUsers(users);
      } catch (e: any) {
        setError("Failed to add recipient. Please try again.");
        console.error(e);
      } finally {
        setAdding(false);
      }
    }
  };

  return (
    <div className="min-h-screen p-4 bg-gray-50">
      <Navbar />
      <div className="space-y-4 relative">
        <div className="mt-16">
          {/* Add Recipient Form */}
          <Card className="rounded-xl w-full border-0 shadow-lg">
            <CardContent className="space-y-4">
              <h3 className="text-xl font-semibold">Add a New Recipient</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input
                  type="text"
                  placeholder="Name"
                  value={newRecipient.name}
                  onChange={(e) =>
                    setNewRecipient({ ...newRecipient, name: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
                <select
                  value={newRecipient.bank}
                  onChange={(e) =>
                    setNewRecipient({ ...newRecipient, bank: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  disabled={loading}
                >
                  <option value="">Select Bank</option>
                  {banks.map((bank) => (
                    <option key={bank.bankCode} value={bank.bankName}>
                      {bank.bankName}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Phone Number (Transfiya)"
                  value={newRecipient.bankNumber}
                  onChange={(e) =>
                    setNewRecipient({
                      ...newRecipient,
                      bankNumber: e.target.value,
                    })
                  }
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <Button
                onClick={handleAddRecipient}
                className="w-full rounded-xl text-white bg-gradient-to-r from-[#48b395] to-[#247469] hover:opacity-90"
                disabled={adding}
              >
                {adding ? "Adding..." : "Add Recipient"}
              </Button>
              {error && <p className="text-red-500 text-sm">{error}</p>}
            </CardContent>
          </Card>

          {/* Recipients List */}
          <div className="mt-8" /> {/* Add vertical space between the two cards */}
          <Card className="rounded-xl w-full border-0 shadow-lg">
            <CardContent>
              <h3 className="text-xl font-semibold mb-4">Recipients List</h3>
              {partnerUsers && partnerUsers.users.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="py-2 px-4 font-medium">User ID</th>
                        <th className="py-2 px-4 font-medium">Account Number</th>
                        <th className="py-2 px-4 font-medium">Bank</th>
                        <th className="py-2 px-4 font-medium">KYC Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partnerUsers.users.map((user, index) => (
                        <tr key={user.id || index} className="border-b border-gray-100">
                          <td className="py-2 px-4">{user.userId}</td>
                          <td className="py-2 px-4">{user.accountNumber || "-"}</td>
                          <td className="py-2 px-4">{user.bank || "-"}</td>
                          <td className="py-2 px-4">{user.kycStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-600">No recipients added yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}