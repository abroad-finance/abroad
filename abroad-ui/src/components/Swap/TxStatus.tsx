import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../Button';
import { IconAnimated } from '../IconAnimated';
import { TransactionStatus as ApiStatus, getTransactionStatus } from '../../api';

// UI status mapping
type UiStatus = 'inProgress' | 'accepted' | 'denied';

export interface TxStatusProps {
  transactionId: string | null;
  onNewTransaction: () => void;
  onRetry: () => void;
}

export default function TxStatus({ transactionId, onNewTransaction, onRetry }: TxStatusProps): React.JSX.Element {
  const [status, setStatus] = useState<UiStatus>('inProgress');
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Map API status to UI status
  const mapStatus = (api?: ApiStatus): UiStatus => {
    switch (api) {
      case 'PAYMENT_COMPLETED': return 'accepted';
      case 'PAYMENT_FAILED':
      case 'WRONG_AMOUNT': return 'denied';
      case 'AWAITING_PAYMENT':
      case 'PROCESSING_PAYMENT':
      default: return 'inProgress';
    }
  };

  // Poll transaction status
  useEffect(() => {
    if (!transactionId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await getTransactionStatus(transactionId);
        if (cancelled) return;
        const ui = mapStatus(res.data?.status as ApiStatus);
        setStatus(ui);
        if (ui === 'inProgress') {
          pollRef.current = window.setTimeout(poll, 1000);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Error obteniendo estado');
        // retry slower
        pollRef.current = window.setTimeout(poll, 1000);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [transactionId]);

  const renderIcon = () => {
    switch (status) {
      case 'inProgress':
        return <IconAnimated icon='Coins' size={150} trigger='loop' />;
      case 'accepted':
        return <IconAnimated icon='AnimatedCheck' size={150} trigger='once' />;
      case 'denied':
        return <IconAnimated icon='Denied' size={150} trigger='once' />;
    }
  };

  const renderStatusText = () => {
    switch (status) {
      case 'inProgress': return 'Procesando Transacción';
      case 'accepted': return 'Retiro Realizado';
      case 'denied': return 'Transacción Rechazada';
    }
  };

  const renderSubtitle = () => {
    switch (status) {
      case 'inProgress':
        return <>Tu solicitud está siendo procesada. <br /> Esto tomará algunos segundos.</>;
      case 'accepted':
        return <>¡Super! <br /> Todo salió bien y tu retiro ha sido exitoso.</>;
      case 'denied':
        return <>La solicitud ha sido rechazada y tus fondos han sido devueltos. Puedes intentar nuevamente más tarde.</>;
    }
  };

  return (
    <div className=" flex-1 flex flex-col items-center justify-center w-full space-y-6">
      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div
        id="bg-container"
        className="relative w-[90%] max-w-[50vh] h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-6 flex flex-col items-center justify-center space-y-4"
      >
        {/* Status Icon */}
        <div>
          {renderIcon()}
        </div>
        {/* Title */}
        <div className="text-2xl font-bold text-[#356E6A] text-center">
          {renderStatusText()}
        </div>

        {/* Description */}
        <div className="text-[#356E6A]/90 text-center">
          {renderSubtitle()}
        </div>
      </div>

      {(status === 'accepted' || status === 'denied') && (
        <Button
          onClick={status === 'accepted' ? onNewTransaction : onRetry}
          className="mt-4 w-[90%] max-w-[50vh] py-4"
        >
          {status === 'accepted' ? 'Realizar otra transacción' : 'Intentar Nuevamente'}
        </Button>
      )}
    </div>
  );
}