import React, { useState, useEffect, useCallback } from 'react';
import PixFull from '../../assets/Logos/networks/PixFull.svg';
import { Button } from "../Button";
import { Loader, Hash, ArrowLeft, Rotate3d } from 'lucide-react';
import { getBanks, Bank, getBanksResponse200, acceptTransaction, _36EnumsTargetCurrency as TargetCurrency } from '../../api';
import { DropSelector, Option } from '../DropSelector';
import { kit } from '../../services/stellarKit';
import { useWalletAuth } from '../../context/WalletAuthContext';
import {
  Asset,
  Memo,
  Operation,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Transaction,
  Horizon,
} from '@stellar/stellar-sdk';
import { WalletNetwork } from '@creit.tech/stellar-wallets-kit';

const networkPassphrase = Networks.PUBLIC;
const horizonUrl = 'https://horizon.stellar.org';
const server = new Horizon.Server(horizonUrl);

// Bank configuration mapping -------------------------------------------------------
const BANK_CONFIG: Record<string, { iconUrl: string; displayLabel?: string }> = {
  NEQUI: {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Nequi_Badge.webp',
    displayLabel: 'Nequi',
  },
  MOVII: {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/movii_badge.png',
  },
  DAVIPLATA: {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Daviplata_Badge.png',
    displayLabel: 'Daviplata',
  },
  DAVIVIENDA: {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Davivienda_Badge.png',
    displayLabel: 'Davivienda',
  },
  BANCOLOMBIA: {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bancolombia_Badge.png',
  },
  SUPERDIGITAL: {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Superdigital_Badge.png',
  },
  'BANCO ITAU': {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Itau_Badge.png',
    displayLabel: 'Itau',
  },
  'BANCO FALABELLA': {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Falabella_Badge.png',
  },
  'BANCO COOPERATIVO COOPCENTRAL DIGITAL': {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bcc_Badge.jpg',
    displayLabel: 'Coopcentral',
  },
  'BANCO SERFINANZA': {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bancoserfinanza_badge.jpg',
    displayLabel: 'Serfinanza',
  },
  BANCOBBVA: {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/BBVA_Badge.jpg',
    displayLabel: 'BBVA',
  },
  'BANCO POWWI': {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Powwico_Badge.jpg',
    displayLabel: 'Powwi',
  },
  'BANCO CAJA SOCIAL': {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/CajaSocial_Badge.webp',
    displayLabel: 'Banco Caja Social',
  },
  'BANCO AGRARIO DE COLOMBIA': {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/BancoAgrario_Badge.jpg',
    displayLabel: 'Banco Agrario',
  },
  'BANCO DE LAS MICROFINANZAS BANCAMIA SA': {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bancamia_Badge.jpg',
    displayLabel: 'Bancamia',
  },
  'BANCO CREZCAMOS': {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/BancoCrezcamos_Badge.png',
    displayLabel: 'Banco Crezcamos',
  },
  'BANCO FINANDINA': {
    iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/BancoFinandina_Badge.png',
    displayLabel: 'Banco Finandina',
  },
};

// Banks to exclude --------------------------------------------------------------
const EXCLUDED_BANKS = [
  'CFA COOPERATIVA FINANCIERA',
  'CONFIAR COOPERATIVA FINANCIERA',
  'BANCOCOOPCENTRAL',
];

const PENDING_TX_KEY = 'pendingTransaction';

interface BankDetailsRouteProps {
  onBackClick: () => void;
  onTransactionComplete: ({ memo }: { memo: string | null }) => Promise<void>;
  onTransactionFailed: () => void;
  // called immediately after user signs the transaction (before or during submission) to show status screen
  onTransactionSigned: (id: string | null, transactionReference: string | null) => void;
  quote_id: string;
  sourceAmount: string; // Amount the user sends (Stellar asset)
  targetAmount: string; // Amount receiver gets (COP)
  userId: string;
  textColor?: string;
  targetCurrency?: (typeof TargetCurrency)[keyof typeof TargetCurrency];
  pixKey: string; // For BRL transfers
  setPixKey: (key: string) => void;
  taxId: string;
  setTaxId: (id: string) => void;
}

export default function BankDetailsRoute({
  userId,
  onBackClick,
  quote_id,
  sourceAmount,
  targetAmount,
  onTransactionComplete,
  onTransactionFailed,
  onTransactionSigned,
  textColor = '#356E6A',
  targetCurrency = TargetCurrency.COP,
  pixKey,
  setPixKey,
  taxId,
  setTaxId,
}: BankDetailsRouteProps): React.JSX.Element {
  const { walletId, token, address } = useWalletAuth();

  // ------------------------------- UI STATE -----------------------------------
  const [account_number, setaccount_number] = useState('');
  const [bank_code, setbank_code] = useState<string>('');
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<Option | null>(null);

  // ------------------------------ BANKS API -----------------------------------
  const [apiBanks, setApiBanks] = useState<Bank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState<boolean>(false);
  const [errorBanks, setErrorBanks] = useState<string | null>(null);

  // Restore saved details (returning from KYC) ---------------------------------
  useEffect(() => {
    const stored = localStorage.getItem(PENDING_TX_KEY);
    if (stored && token) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.account_number) setaccount_number(parsed.account_number);
        if (parsed.bank_code) setbank_code(parsed.bank_code);
        if (parsed.pixKey) setPixKey(parsed.pixKey);
        if (parsed.taxId) setTaxId(parsed.taxId);
        if (parsed.selectedBank) setSelectedBank(parsed.selectedBank);
      } catch (e) {
        console.error('Failed to restore pending transaction', e);
      }
    }
  }, [setPixKey, setTaxId, token]);

  // Fetch banks once -----------------------------------------------------------
  useEffect(() => {
    (async () => {
      if (targetCurrency !== TargetCurrency.COP) return; // Only fetch banks for COP flow
      setLoadingBanks(true);
      setErrorBanks(null);
      try {
        const response = await getBanks();
        if (
          response.status === 200 &&
          (response as getBanksResponse200).data?.banks
        ) {
          setApiBanks((response as getBanksResponse200).data.banks);
        } else {
          const errorMessage =
            response.status === 400
              ? 'Bad request to bank API.'
              : `Failed to fetch banks. Status: ${response.status}`;
          setErrorBanks(errorMessage);
          console.error('Error fetching banks:', response);
        }
      } catch (err) {
        setErrorBanks(
          err instanceof Error
            ? err.message
            : 'An unknown error occurred while fetching banks.',
        );
        console.error(err);
      } finally {
        setLoadingBanks(false);
      }
    })();
  }, [targetCurrency]);

  // --------------------------- INPUT HANDLERS ---------------------------------
  const handleaccount_numberChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const input = e.target.value.replace(/[^\d]/g, '').slice(0, 10); // 10 digits max
    setaccount_number(input);
  };
  const handleTaxIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value.replace(/[^\d]/g, '').slice(0, 11); // 11 digits
    setTaxId(input);
  };

  const handleBankSelect = (option: Option) => {
    setSelectedBank(option);
    setbank_code(option.value);
  };

  // Map banks to dropdown options ---------------------------------------------
  const bankOptions: Option[] = apiBanks
    .filter(
      (bank: Bank) => !EXCLUDED_BANKS.includes(bank.bankName.toUpperCase()),
    )
    .map((bank: Bank) => {
      const bankNameUpper = bank.bankName.toUpperCase();
      const config = BANK_CONFIG[bankNameUpper];
      return {
        value: String(bank.bankCode),
        label: config?.displayLabel || bank.bankName,
        iconUrl: config?.iconUrl,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  // --------------------------- HELPERS ----------------------------------------


  const buildPaymentXdr = useCallback(async ({
    source,
    destination,
    amount,
    asset,
    memoValue,
  }: {
    source: string;
    destination: string;
    amount: string;
    asset: Asset;
    memoValue: string;
  }): Promise<string> => {
    const account = await server.loadAccount(source);
    const fee = await server.fetchBaseFee();

    const tx = new TransactionBuilder(account, {
      fee: String(fee || BASE_FEE),
      networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination,
          amount,
          asset,
        }),
      )
      .addMemo(Memo.text(memoValue))
      .setTimeout(180)
      .build();

    return tx.toXDR();
  }, []);

  // --------------------------- SUBMIT FLOW ------------------------------------
  const handleSubmit = useCallback(async () => {
    setLoadingSubmit(true);

    try {
      if (!quote_id) throw new Error('Quote ID missing.');


      // 1️⃣  Reserve quote & obtain details ------------------------------------
      const redirectUrl = encodeURIComponent(
        window.location.href.replace(/^https?:\/\//, ''),
      );
      const response = await acceptTransaction({
        account_number: targetCurrency === TargetCurrency.BRL ? pixKey : account_number,
        bank_code: targetCurrency === TargetCurrency.BRL ? 'PIX' : bank_code,
        tax_id: targetCurrency === TargetCurrency.BRL ? taxId : undefined,
        quote_id,
        user_id: userId,
        redirectUrl,
      });

      if (response.status !== 200) {
        alert(`Error prttod: ${response.data.reason}`);
        return;
      }

      const {
        kycLink,
        transaction_reference,
        id: acceptedTxId,
      } = response.data;
      const stellar_account = import.meta.env.VITE_ABROAD_STELLAR_ADDRESS;
      const asset_code = "USDC";
      const asset_issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

      // 2️⃣  Redirect to KYC if needed ----------------------------------------
      if (kycLink) {
        localStorage.setItem(
          PENDING_TX_KEY,
          JSON.stringify({
            quote_id,
            srcAmount: sourceAmount,
            tgtAmount: targetAmount,
            account_number: targetCurrency === TargetCurrency.BRL ? pixKey : account_number,
            bank_code: targetCurrency === TargetCurrency.BRL ? 'PIX' : bank_code,
            pixKey: targetCurrency === TargetCurrency.BRL ? pixKey : undefined,
            taxId: targetCurrency === TargetCurrency.BRL ? taxId : undefined,
            userId,
            selectedBank,
            targetCurrency,
          }),
        );
        window.location.href = kycLink;
        return;
      }

      // 6️⃣  Cleanup ------------------------------------------------------------
      localStorage.removeItem(PENDING_TX_KEY);

      if (!walletId) {
        const queryParams = new URLSearchParams(window.location.search);
        const callbackUrl = queryParams.get('callback');
        const sepTransactionId = queryParams.get('transaction_id');
        const sepBaseUrl = import.meta.env.VITE_SEP_BASE_URL || 'http://localhost:8000';
        let url = encodeURI(`${sepBaseUrl}/sep24/transactions/withdraw/interactive/complete?amount_expected=${sourceAmount}&transaction_id=${sepTransactionId}`);
        if (callbackUrl && callbackUrl.toLowerCase() !== 'none') {
          url += `&callback=${encodeURIComponent(callbackUrl)}`;
        }
        if (transaction_reference) {
          url += `&memo=${encodeURIComponent(transaction_reference)}`;
        }
        localStorage.removeItem(PENDING_TX_KEY);
        window.location.href = url;
        return;
      }

      // 3️⃣  Build payment XDR --------------------------------------------------
      const paymentAsset = new Asset(asset_code, asset_issuer);

      if (!address) {
        throw new Error('Wallet address is not available.');
      }

      const unsignedXdr = await buildPaymentXdr({
        source: address,
        destination: stellar_account,
        amount: sourceAmount,
        asset: paymentAsset,
        memoValue: transaction_reference ?? ""
      });

      // 4️⃣  Sign via kit -------------------------------------------------------
      const { signedTxXdr } = await kit.signTransaction(unsignedXdr, {
        address: walletId,
        networkPassphrase: WalletNetwork.PUBLIC,
      });

      // Show transaction status UI right after signing
      try { onTransactionSigned(acceptedTxId || null, transaction_reference || null); } catch (e) { console.warn('onTransactionSigned failed', e); }

      // 5️⃣  Submit -------------------------------------------------------------
      const tx = new Transaction(signedTxXdr, networkPassphrase);
      await server.submitTransaction(tx);


      await onTransactionComplete({ memo: transaction_reference });
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Transaction error');
    } finally {
      setLoadingSubmit(false);
      onTransactionFailed();
    }
  }, [
    quote_id,
    targetCurrency,
    pixKey,
    account_number,
    bank_code,
    taxId,
    userId,
    walletId,
    address,
    buildPaymentXdr,
    sourceAmount,
    onTransactionComplete,
    targetAmount,
    selectedBank,
    onTransactionSigned,
    onTransactionFailed
  ]);

  // ------------------------------- RENDER -------------------------------------
  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">
      <div
        id="bg-container"
        className="relative w-[90%] max-w-md min-h-[60vh] h-auto bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center space-y-4"
      >
        {/* Header */}
        <div className="w-full flex items-center space-x-3 mb-2 flex-shrink-0">
          <button
            onClick={onBackClick}
            className="hover:text-opacity-80 transition-colors cursor-pointer"
            style={{ color: textColor }}
            aria-label="Go back"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div
            id="Title"
            className="text-xl sm:text-2xl font-bold flex-grow text-center"
            style={{ color: textColor }}
          >
            Datos de Transacción
          </div>
        </div>

        {/* Inputs */}
        <div className="flex-1 flex flex-col items-center justify-center w-full space-y-3 py-2">
          {targetCurrency === TargetCurrency.BRL ? (
            <>
              {/* PIX Key */}
              <div id="pix-key-input" className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 flex items-center space-x-3">
                <Hash className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: textColor }} />
                <input
                  type="text"
                  inputMode="text"
                  placeholder="PIX Key"
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  className="w-full bg-transparent font-semibold focus:outline-none text-base sm:text-lg"
                  style={{ color: textColor }}
                />
              </div>
              {/* CPF */}
              <div id="cpf-input" className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 flex items-center space-x-3">
                <Hash className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: textColor }} />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="CPF"
                  value={taxId}
                  onChange={handleTaxIdChange}
                  className="w-full bg-transparent font-semibold focus:outline-none text-base sm:text-lg"
                  style={{ color: textColor }}
                />
              </div>
            </>
          ) : (
            <>
              {/* Transfiya number */}
              <div
                id="bank-account-input"
                className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 flex items-center space-x-3"
              >
                <Hash className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: textColor }} />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Número Transfiya"
                  value={account_number}
                  onChange={handleaccount_numberChange}
                  className="w-full bg-transparent font-semibold focus:outline-none text-base sm:text-lg"
                  style={{ color: textColor }}
                />
              </div>

              {/* Bank selector */}
              <div
                id="bank-selector"
                className="w-full bg-white/60 backdrop-blur-xl rounded-2xl flex-shrink-0 relative z-50"
              >
                {loadingBanks && (
                  <div className="p-6 flex items-center space-x-3">
                    <Loader
                      className="animate-spin w-4 h-4 sm:w-5 sm:h-5"
                      style={{ color: textColor }}
                    />
                  </div>
                )}
                {errorBanks && (
                  <div className="p-6 flex items-center space-x-3">
                    <p className="text-red-500 text-xs sm:text-sm">{errorBanks}</p>
                  </div>
                )}
                {!loadingBanks && !errorBanks && apiBanks.length === 0 && (
                  <div className="p-6 flex items-center space-x-3">
                    <p className="text-[#356E6A]/70 text-xs sm:text-sm">
                      No hay bancos disponibles.
                    </p>
                  </div>
                )}
                {!loadingBanks && !errorBanks && apiBanks.length > 0 && (
                  <div className="p-6 flex items-center space-x-3 w-full">
                    <div className="flex-1">
                      <DropSelector
                        options={bankOptions}
                        selectedOption={selectedBank}
                        onSelectOption={handleBankSelect}
                        isOpen={bankOpen}
                        setIsOpen={setBankOpen}
                        placeholder="Banco"
                        disabled={loadingBanks || errorBanks !== null}
                        textColor={textColor}
                        placeholderIcons={[
                          'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Nequi_Badge.webp',
                          'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Daviplata_Badge.png',
                          'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bancolombia_Badge.png',
                        ]}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Amount info */}
          <div
            id="tx-info"
            className="relative font-medium w-full flex items-center space-x-1"
            style={{ color: textColor }}
          >
            <span className="text-sm sm:text-base">Monto a recibir:</span>
            <img
              className="w-4 h-4 sm:w-5 sm:h-5 rounded-full"
              src={
                targetCurrency === TargetCurrency.BRL
                  ? 'https://hatscripts.github.io/circle-flags/flags/br.svg'
                  : 'https://hatscripts.github.io/circle-flags/flags/co.svg'
              }
              alt={targetCurrency === TargetCurrency.BRL ? 'Brazil flag' : 'Colombia flag'}
            />
            <b className="text-sm sm:text-base"> {targetCurrency === TargetCurrency.BRL ? 'R$' : '$'}{targetAmount}</b>
          </div>
        </div>

        {/* Disclaimer */}
        <div
          id="transfer-disclaimer"
          className="relative w-full bg-white/10 backdrop-blur-xl rounded-2xl p-3 sm:p-4 flex flex-col space-y-2"
          style={{ color: textColor }}
        >
          {targetCurrency === TargetCurrency.BRL ? (
            <>
              <div className="flex items-center space-x-2">
                <Rotate3d className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="font-medium text-xs sm:text-sm">Red:</span>
                <div className="bg-white/70 backdrop-blur-md rounded-lg px-2 py-1 flex items-center">
                  <img
                    src={PixFull}
                    alt="PIX Logo"
                    className="h-3 sm:h-4 w-auto"
                  />
                </div>
              </div>
              <span className="font-medium text-xs pl-1" style={{ color: textColor }}>
                Tu transacción será procesada de inmediato. Asegúrate de que la llave PIX y el CPF del destinatario sean correctos. Esta transacción no se puede reversar.
              </span>
            </>
          ) : (
            <>
              <div className="flex items-center space-x-2">
                <Rotate3d className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="font-medium text-xs sm:text-sm">Red:</span>
                <div className="bg-white/70 backdrop-blur-md rounded-lg px-2 py-1 flex items-center">
                  <img
                    src="https://vectorseek.com/wp-content/uploads/2023/11/Transfiya-Logo-Vector.svg-.png"
                    alt="Transfiya Logo"
                    className="h-3 sm:h-4 w-auto"
                  />
                </div>
              </div>
              <span className="font-medium text-xs pl-1" style={{ color: textColor }}>
                Tu transacción será procesada de inmediato y llegará instantáneamente. Ten
                presente que el receptor debe tener activado Transfiya en el banco
                indicado.
              </span>
            </>
          )}
        </div>
      </div>

      {/* Continue button */}
      <Button
        className="mt-4 w-[90%] max-w-md py-4 cursor-pointer"
        onClick={handleSubmit}
        disabled={
          loadingSubmit ||
          (targetCurrency === TargetCurrency.BRL
            ? !(pixKey && taxId)
            : (!bank_code || account_number.length !== 10 || loadingBanks))
        }
      >
        {loadingSubmit ? (
          <Loader className="animate-spin w-4 h-4 sm:w-5 sm:h-5" />
        ) : (
          'Continuar'
        )}
      </Button>
    </div>
  );
}
