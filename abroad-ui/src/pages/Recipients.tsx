import { Card, CardContent } from "../components/card";
import { Button } from "../components/Button";
import Navbar from "../components/navbar";
import { getBanks, type Bank, createPartnerUser, PaymentMethod, listPartnerUsers, PaginatedPartnerUsers } from "../api/apiClient";
import { useEffect, useState } from "react";
import { useLanguage } from '../contexts/LanguageContext';

export default function Recipients() {
  const { language } = useLanguage();
  const t = {
    en: {
      addTitle: 'Add a New Recipient',
      listTitle: 'Recipients List',
      namePlaceholder: 'Name',
      bankPlaceholder: 'Select Bank',
      numberPlaceholder: 'Phone Number (Transfiya)',
      addButton: 'Add Recipient',
      adding: 'Adding...',
      noRecipients: 'No recipients added yet.',
      table: {
        userId: 'User ID',
        accountNumber: 'Account Number',
        bank: 'Bank',
        kycStatus: 'KYC Status'
      }
    },
    es: {
      addTitle: 'Agregar un nuevo destinatario',
      listTitle: 'Lista de destinatarios',
      namePlaceholder: 'Nombre',
      bankPlaceholder: 'Seleccionar banco',
      numberPlaceholder: 'Número de teléfono (Transfiya)',
      addButton: 'Agregar destinatario',
      adding: 'Agregando...',
      noRecipients: 'No hay destinatarios aún.',
      table: {
        userId: 'ID de usuario',
        accountNumber: 'Número de cuenta',
        bank: 'Banco',
        kycStatus: 'Estado KYC'
      }
    },
    pt: {
      addTitle: 'Adicionar novo destinatário',
      listTitle: 'Lista de destinatários',
      namePlaceholder: 'Nome',
      bankPlaceholder: 'Selecionar banco',
      numberPlaceholder: 'Número de telefone (Transfiya)',
      addButton: 'Adicionar destinatário',
      adding: 'Adicionando...',
      noRecipients: 'Nenhum destinatário ainda.',
      table: {
        userId: 'ID do usuário',
        accountNumber: 'Número da conta',
        bank: 'Banco',
        kycStatus: 'Status KYC'
      }
    },
    zh: {
      addTitle: '添加新收件人',
      listTitle: '收件人列表',
      namePlaceholder: '姓名',
      bankPlaceholder: '选择银行',
      numberPlaceholder: '电话号码（Transfiya）',
      addButton: '添加收件人',
      adding: '正在添加...',
      noRecipients: '暂时没有收件人。',
      table: {
        userId: '用户 ID',
        accountNumber: '账户号码',
        bank: '银行',
        kycStatus: 'KYC 状态'
      }
    }
  }[language];

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
      } catch (e: unknown) {
        if (e instanceof Error) {
          console.error(e.message);
        } else {
          console.error("An unknown error occurred.");
        }
        setError("Failed to add recipient. Please try again.");
        console.error(e);
      } finally {
        setAdding(false);
      }
    }
  };

  return (
    <div className="min-h-screen p-4 bg-gray-50">
      <Navbar
        activeSection="recipients"
        setActiveSection={(section) => console.log(`Active section set to: ${section}`)}
      />
      <div className="space-y-4 relative">
        <div className="mt-4">
          {/* Add Recipient Form */}
          <Card className="rounded-xl w-full border-0 shadow-lg">
            <CardContent className="space-y-4">
              <h3 className="text-xl font-semibold">{t.addTitle}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input
                  type="text"
                  placeholder={t.namePlaceholder}
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
                  <option value="">{t.bankPlaceholder}</option>
                  {banks.map((bank) => (
                    <option key={bank.bankCode} value={bank.bankCode}>
                      {bank.bankName}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder={t.numberPlaceholder}
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
                {adding ? t.adding : t.addButton}
              </Button>
              {error && <p className="text-red-500 text-sm">{error}</p>}
            </CardContent>
          </Card>

          {/* Recipients List */}
          <div className="mt-8" /> {/* Add vertical space between the two cards */}
          <Card className="rounded-xl w-full border-0 shadow-lg">
            <CardContent>
              <h3 className="text-xl font-semibold mb-4">{t.listTitle}</h3>
              {partnerUsers && partnerUsers.users.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="py-2 px-4 font-medium">{t.table.userId}</th>
                        <th className="py-2 px-4 font-medium">{t.table.accountNumber}</th>
                        <th className="py-2 px-4 font-medium">{t.table.bank}</th>
                        <th className="py-2 px-4 font-medium">{t.table.kycStatus}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partnerUsers.users.map((user, index) => (
                        <tr key={user.id || index} className="border-b border-gray-100">
                          <td className="py-2 px-4">{user.userId}</td>
                          <td className="py-2 px-4">{user.accountNumber || "-"}</td>
                          <td className="py-2 px-4">
                            {Number(user.bank) === 1007 ? (
                              <img
                                src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Bancolombia_S.A._logo.svg/2560px-Bancolombia_S.A._logo.svg.png"
                                alt="Bancolombia"
                                className="w-40 h-6"
                              />
                            ) : (
                              banks.find(bank => bank.bankCode.toString() === user.bank)?.bankName || "-"
                            )}
                          </td>
                          <td className="py-2 px-4">{user.kycStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-600">{t.noRecipients}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
