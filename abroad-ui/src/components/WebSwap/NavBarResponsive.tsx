import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Info, Wallet, Languages } from "lucide-react";
import { Horizon } from "@stellar/stellar-sdk";

import { useWalletAuth } from "../../context/WalletAuthContext";
import { kit } from "../../services/stellarKit";

import AbroadLogoColored from "../../assets/Logos/AbroadLogoColored.svg";
import AbroadLogoWhite from "../../assets/Logos/AbroadLogoWhite.svg";
import FreighterLogo from "../../assets/Logos/Wallets/Freighter.svg";
import HanaLogo from "../../assets/Logos/Wallets/Hana.svg";
import LobstrLogo from "../../assets/Logos/Wallets/Lobstr.svg";

/**
 * ----------------------------------------------------------------------------
 * Configuration
 * ----------------------------------------------------------------------------
 * Allow overrides via props while keeping safe defaults for mainnet USDC.
 */
const DEFAULT_HORIZON_URL = "https://horizon.stellar.org";
const DEFAULT_USDC_ISSUER =
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"; // Circle USDC Issuer (mainnet)
const DEFAULT_INFO_URL = "https://linktr.ee/Abroad.finance";

/**
 * ----------------------------------------------------------------------------
 * Utilities & Types
 * ----------------------------------------------------------------------------
 */
type ClassValue = string | false | null | undefined;
const cn = (...classes: ClassValue[]) => classes.filter(Boolean).join(" ");

type WalletKind =
  | "freighter"
  | "hana"
  | "lobstr"
  | "xbull"
  | "rabet"
  | "stellar"
  | "unknown";

type NonNativeBalance = {
  asset_type: string; // 'credit_alphanum4' | 'credit_alphanum12'
  asset_code: string;
  asset_issuer: string;
  balance: string;
};

type NativeBalance = {
  asset_type: "native";
  balance: string;
};

type BalanceLine = NonNativeBalance | NativeBalance;

type AccountLike = {
  balances: BalanceLine[];
};

const formatWalletAddress = (address?: string | null) => {
  if (!address) return "No conectado";
  const trimmed = address.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
};

const formatFiat = (value: number | string) => {
  const n = typeof value === "number" ? value : parseFloat(value || "0");
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const normalizeWalletKind = (id?: string | null): WalletKind => {
  if (!id) return "unknown";
  const v = id.toLowerCase();
  if (v.includes("freighter")) return "freighter";
  if (v.includes("hana")) return "hana";
  if (v.includes("lobstr")) return "lobstr";
  if (v.includes("xbull")) return "xbull";
  if (v.includes("rabet")) return "rabet";
  if (v.includes("stellar") || v.includes("trust")) return "stellar";
  return "unknown";
};

const walletPresentation: Record<
  WalletKind,
  { name: string; icon?: string }
> = {
  freighter: { name: "Freighter", icon: FreighterLogo },
  hana: { name: "Hana", icon: HanaLogo },
  lobstr: { name: "Lobstr", icon: LobstrLogo },
  xbull: { name: "xBull" },
  rabet: { name: "Rabet" },
  stellar: { name: "Stellar Wallet" },
  unknown: { name: "Stellar Wallet" },
};

/**
 * Fetch the USDC balance for a Stellar account. Returns a numeric string (e.g., "12,345.67").
 * On failure or no trustline, returns "0.00". Distinguishes simple transient errors with "Error".
 */
async function fetchUSDCBalance(opts: {
  horizonUrl: string;
  address: string;
  usdcIssuer: string;
}): Promise<string> {
  const { horizonUrl, address, usdcIssuer } = opts;

  try {
    const server = new Horizon.Server(horizonUrl);
    const account = (await server.loadAccount(address)) as AccountLike;

    const usdc = account.balances.find(
      (b: BalanceLine): b is NonNativeBalance =>
        b.asset_type !== "native" &&
        "asset_code" in b &&
        b.asset_code === "USDC" &&
        "asset_issuer" in b &&
        b.asset_issuer === usdcIssuer
    );

    if (!usdc) return "0.00";
    return formatFiat(usdc.balance);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Common cases: unfunded account / network blips.
    if (message.toLowerCase().includes("not found")) return "0.00";
    if (message.toLowerCase().includes("network")) return "Error";

    // Default fallback
    return "0.00";
  }
}

/**
 * React hook to manage USDC balance with loading & refetch.
 * Avoids state updates after unmount and coalesces rapid refetches.
 */
function useUSDCBalance(
  address?: string | null,
  horizonUrl: string = DEFAULT_HORIZON_URL,
  usdcIssuer: string = DEFAULT_USDC_ISSUER
) {
  const [balance, setBalance] = useState<string>("0.00");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(0);

  const refetch = useCallback(async () => {
    if (!address) {
      setBalance("0.00");
      setError(null);
      return;
    }

    const token = ++inFlight.current;
    setLoading(true);
    setError(null);

    try {
      const b = await fetchUSDCBalance({ address, horizonUrl, usdcIssuer });
      if (token === inFlight.current) setBalance(b);
    } catch (e) {
      if (token === inFlight.current) {
        setError(e instanceof Error ? e.message : String(e));
        setBalance("0.00");
      }
    } finally {
      if (token === inFlight.current) setLoading(false);
    }
  }, [address, horizonUrl, usdcIssuer]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { balance, loading, error, refetch };
}

/**
 * ----------------------------------------------------------------------------
 * Props
 * ----------------------------------------------------------------------------
 */
export interface NavBarResponsiveProps {
  /** Additional classes for the outer nav container */
  className?: string;
  /** Custom handler to trigger a connect flow. If not provided, falls back to `kit.openModal` */
  onWalletConnect?: () => void;
  /** Called when the user clicks the wallet while connected */
  onWalletDetails?: () => void;
  /** Called when the user clicks the settings button */
  onSettingsOpen?: () => void;
  /** Override the Horizon URL (useful for testnet or proxies) */
  horizonUrl?: string;
  /** Override the USDC issuer (e.g., testing assets) */
  usdcIssuer?: string;
  /** Override the info button URL */
  infoUrl?: string;
}

/**
 * ----------------------------------------------------------------------------
 * Component
 * ----------------------------------------------------------------------------
 */
const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({
  className = "",
  onWalletConnect,
  onWalletDetails,
  onSettingsOpen,
  horizonUrl = DEFAULT_HORIZON_URL,
  usdcIssuer = DEFAULT_USDC_ISSUER,
  infoUrl = DEFAULT_INFO_URL,
}) => {
  const { address, walletId, authenticateWithWallet } = useWalletAuth();
  const { balance, loading } = useUSDCBalance(address, horizonUrl, usdcIssuer);

  /**
   * Handlers
   */
  const handleDirectWalletConnect = useCallback(() => {
    // Prefer a provided handler, else fall back to the kit modal.
    if (onWalletConnect) {
      onWalletConnect();
      return;
    }

    try {
      kit?.openModal?.({
        onWalletSelected: async (option: { id: string }) => {
          await authenticateWithWallet(option.id);
        },
      });
    } catch {
      // As a last resort, do nothing rather than crash the UI.
    }
  }, [onWalletConnect, authenticateWithWallet]);

  const handleWalletClick = useCallback(() => {
    if (address) {
      onWalletDetails?.();
    } else {
      handleDirectWalletConnect();
    }
  }, [address, onWalletDetails, handleDirectWalletConnect]);

  const handleSettingsClick = useCallback(() => {
    onSettingsOpen?.();
  }, [onSettingsOpen]);

  /**
   * Presentational data
   */
  const walletInfo = useMemo(() => {
    const kind = normalizeWalletKind(walletId);
    return walletPresentation[kind];
  }, [walletId]);

  /**
   * Render helpers
   */
  const WalletIcon = useMemo(() => {
    if (address && walletInfo.icon) {
      return (
        <img
          src={walletInfo.icon}
          alt={`${walletInfo.name} wallet`}
          className="w-8 h-8"
          loading="lazy"
          width={32}
          height={32}
        />
      );
    }
    return <Wallet className="w-5 h-5 text-white" aria-hidden="true" />;
  }, [address, walletInfo]);

  const USDCBadge = useCallback(
    (isMobile = false) => {
      // On desktop, hide when disconnected; on mobile, still show $0.00 to hint action.
      if (!address && !isMobile) return null;

      const iconSize = "w-4 h-4";
      const textSize = "text-sm";
      const loadingSize = isMobile ? "w-10 h-3" : "w-12 h-4";
      const textColor = isMobile ? "text-[#356E6A]" : "text-white";
      const isError = balance === "Error";

      return (
        <div
          className="flex items-center space-x-1 bg-white/30 rounded-lg px-2 py-1"
          aria-live="polite"
          aria-busy={loading}
          title={isError ? "Network error while fetching balance" : "USDC balance"}
        >
          <img
            src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
            alt="USDC"
            className={iconSize}
            loading="lazy"
            width={16}
            height={16}
          />
          {loading && address ? (
            <div className={`${loadingSize} bg-white/20 rounded animate-pulse`} />
          ) : (
            <span className={`${textColor} ${textSize} font-medium`}>
              ${address ? (isError ? "—" : balance) : "0.00"}
            </span>
          )}
        </div>
      );
    },
    [address, balance, loading]
  );

  const InfoButton = useCallback(
    (isMobile = false) => {
      const buttonClasses = isMobile
        ? "p-2 rounded-full bg-[#356E6A]/5 hover:bg-[#356E6A]/10 transition-colors duration-200"
        : "p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors duration-200";
      const iconColor = isMobile ? "text-[#356E6A]" : "text-white";

      return (
        <button
          type="button"
          onClick={() => {
            // Avoid SSR breaking on 'window'
            if (typeof window !== "undefined") {
              window.open(infoUrl, "_blank", "noopener,noreferrer");
            }
          }}
          className={buttonClasses}
          aria-label="Información de Abroad"
        >
          <Info className={cn("w-5 h-5", iconColor)} aria-hidden="true" />
        </button>
      );
    },
    [infoUrl]
  );

  /**
   * UI
   */
  return (
    <nav className={cn("w-full px-4 pt-4", className)} role="navigation">
      <div className="max-w-8xl mx-auto bg-transparent md:bg-[#356E6A]/5 backdrop-blur-md rounded-2xl">
        <div className="sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex-shrink-0">
              {/* Mobile Logo - Colored */}
              <img
                src={AbroadLogoColored}
                alt="Abroad"
                className="h-8 w-auto md:hidden"
                width={32}
                height={32}
              />
              {/* Desktop Logo - White */}
              <img
                src={AbroadLogoWhite}
                alt="Abroad"
                className="h-8 w-auto hidden md:block"
                width={32}
                height={32}
              />
            </div>

            {/* Desktop Right Side */}
            <div className="hidden md:flex items-center space-x-4">
              {/* Languages Button */}
              <button
                type="button"
                onClick={handleSettingsClick}
                className="p-2 rounded-full hover:bg-white/30 transition-colors duration-200"
                aria-label="Más opciones"
              >
                <Languages className="w-6 h-6 text-white" aria-hidden="true" />
              </button>

              {/* Wallet Badge */}
              <button
                type="button"
                onClick={handleWalletClick}
                className="cursor-pointer flex items-center space-x-3 bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2 hover:bg-white/30 transition-colors duration-200"
                aria-label={address ? "Ver detalles de la billetera" : "Conectar Billetera"}
              >
                {WalletIcon}
                <span className="text-white text-md font-medium">
                  {address ? formatWalletAddress(address) : "Conectar Billetera"}
                </span>
                {USDCBadge(false)}
              </button>

              {/* Info Icon */}
              {InfoButton(false)}
            </div>

            {/* Mobile Right Side */}
            <div className="md:hidden">
              <div className="flex items-center space-x-3">
                {/* Languages Button */}
                <button
                  type="button"
                  onClick={handleSettingsClick}
                  className="p-2 rounded-full hover:bg-[#356E6A]/10 transition-colors duration-200"
                  aria-label="Más opciones"
                >
                  <Languages className="w-5 h-5 text-[#356E6A]" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={handleWalletClick}
                  className="flex items-center justify-center bg-[#356E6A]/5 backdrop-blur-xl rounded-xl px-4 py-2 border border-white/30 hover:bg-white/30 transition-colors duration-200 flex-1"
                  aria-label={address ? "Ver detalles de la billetera" : "Conectar Billetera"}
                >
                  {/* When not connected show an explicit connect CTA; when connected show balance badge */}
                  {address ? (
                    USDCBadge(true)
                  ) : (
                    <div className="flex items-center space-x-2">
                      <Wallet className="w-5 h-5 text-[#356E6A]" aria-hidden="true" />
                      <span className="text-[#356E6A] text-sm font-medium">Conectar</span>
                    </div>
                  )}
                </button>
                {/* (Optional) Show info button on mobile too. Comment out if undesired. */}
                {/* {InfoButton(true)} */}
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default memo(NavBarResponsive);
