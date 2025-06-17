import { useCallback, useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import { listPartnerUsers, PaginatedPartnerUsers, listPartnerTransactions, PaginatedTransactionList } from "../api/apiClient";
import { TransactionList } from "../components/TransactionList";
import { Balance } from "../components/Treasury/BalanceOpsRow";
import { LiquidityCards, CardItem } from "../components/Treasury/LiquidityCards";
import { StreamData } from "../components/Treasury/DataAnalytics/AllocationData";
import { TransactionalData } from "../components/Treasury/DataAnalytics/TransactionalData";

export function Dashboard() {
  const [activeSection, setActiveSection] = useState<string>("dashboard");

  return (
    <div className="min-h-screen p-4 space-y-4 bg-gray-50">
      <Navbar activeSection={activeSection} setActiveSection={setActiveSection} />
      <DashboardHome />
    </div>
  );
}


function DashboardHome() {
  const [, setPartnerUsers] = useState<PaginatedPartnerUsers | null>(null);
  const [transactions, setTransactions] = useState<PaginatedTransactionList | null>(null);
  const [liquidityCards, setLiquidityCards] = useState<CardItem[]>([]); // Add liquidity cards state

  useEffect(() => {
    const fetchPartnerUsers = async () => {
      try {
        const users = await listPartnerUsers();
        setPartnerUsers(users);
      } catch (error) {
        console.error("Failed to fetch partner users:", error);
      }
    };
    fetchPartnerUsers();

    const fetchTransactions = async () => {
      try {
        const txs = await listPartnerTransactions();
        setTransactions(txs);
      } catch (error) {
        console.error("Failed to fetch transactions:", error);
      }
    };
    fetchTransactions();
  }, []);

  // Polling: fetch transactions every 5 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const txs = await listPartnerTransactions();
        setTransactions(txs);
      } catch (err) {
        console.error("Failed to fetch transactions:", err);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  
  const handleAddLiquidity = useCallback((item: CardItem) => {
    setLiquidityCards(prev => [...prev, item]);
    console.log('Liquidity card added to Dashboard:', item);
  }, []);

  const handleSend = () => {
    // Placeholder for send functionality
    console.log("Send action triggered");
  };

  const handleReceive = () => {
    // Placeholder for receive functionality
    console.log("Receive action triggered");
  };

  return (
    
    <div className="space-y-4 relative">
      <Balance balance={0} onSend={handleSend} onReceive={handleReceive} onAddLiquidity={handleAddLiquidity} availableAccounts={liquidityCards} />
      
      {/* LiquidityCards - Single column */}
      <LiquidityCards customCards={liquidityCards} onAddLiquidity={handleAddLiquidity} />
      
      {/* Data Analytics - 2 column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StreamData liquidityCards={liquidityCards} />
        <TransactionalData liquidityCards={liquidityCards} />
      </div>
      
      {/* TransactionList - Full width */}
      <TransactionList transactions={transactions} />
    </div>
  );
}