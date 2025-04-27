import React from 'react';
import { CardContent } from "./card";
import { Button } from "./button";

export interface CardProps {
  className?: string;
  style?: React.CSSProperties; // allow inline styles
  children?: React.ReactNode;
}

export function Card({ className, style, children }: CardProps) {
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

interface WalletBalanceProps {
  balance: number;
  isConnecting: boolean;
  publicKey: string | null;
  handleWalletConnection: () => void;
  getWalletMessage: () => string;
}

export function WalletBalance({
  balance,
  isConnecting,
  publicKey,
  handleWalletConnection,
  getWalletMessage
}: WalletBalanceProps) {
  return (
    <Card
      className="rounded-xl w-full border-0 shadow-lg"
      style={{
        backgroundImage: "url('https://framerusercontent.com/images/T3seblTAXRnwsFoImZLGzi5vAg.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      <CardContent className="flex flex-col items-center justify-center text-center h-full">
        <img
          src="https://assets.streamlinehq.com/image/private/w_300,h_300,ar_1/f_auto/v1/icons/vectors/usdc-fpxuadmgafrjjy85bgie5.png/usdc-kksfxcrdl3f9pjx0v6jxxp.png?_a=DAJFJtWIZAAC"
          alt="USDC Logo"
          className="w-10 h-10 mb-2"
        />
        <p className="text-5xl font-bold">
          ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className="text-sm text-gray-600 flex items-center justify-center gap-1 mt-1">
          {getWalletMessage()}
        </p>
        <Button
          onClick={handleWalletConnection}
          className="mt-4 rounded-xl text-white bg-gradient-to-r from-[#48b395] to-[#247469] hover:opacity-90"
          disabled={isConnecting}
        >
          {isConnecting ? "Connecting..." : publicKey ? "Disconnect Wallet" : "Connect Freighter Wallet"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function FreighterGuide() {
  return (
    <Card
      className="rounded-xl w-full border-0 shadow-lg mb-4"
      style={{
        backgroundImage:
          "url('https://static.vecteezy.com/system/resources/previews/026/493/927/non_2x/abstract-gradient-dark-green-liquid-wave-background-free-vector.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <CardContent className="p-6 text-center">
        <h2 className="text-2xl font-bold mb-2 text-white">
          Connect with Freighter Wallet
        </h2>
        <p className="mb-4 text-white">
          Freighter is a non‑custodial Stellar wallet you can use to manage your funds seamlessly on Abroad. Just download Freighter, create a wallet, top it up, connect it to our platform and we will do the rest.
        </p>
        <a
          href="https://www.freighter.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-3 py-1 rounded-full border border-white bg-white-200 text-white text-md font-medium"
        >
          Try Freighter
        </a>
      </CardContent>
    </Card>
  );
}