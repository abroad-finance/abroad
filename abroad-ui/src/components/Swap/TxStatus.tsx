import React, { useState } from 'react';
import { Button } from '../Button';
import { IconAnimated } from '../IconAnimated';

// Mock statuses for visualization purposes
type TransactionStatus = 'inProgress' | 'accepted' | 'denied';

interface TxStatusProps {
  onNewTransaction: () => void;
  onRetry: () => void;
}

export default function TxStatus({ onNewTransaction, onRetry }: TxStatusProps): React.JSX.Element {
  const [status, setStatus] = useState<TransactionStatus>('inProgress');

  const renderIcon = () => {
    switch (status) {
      case 'inProgress':
        return <IconAnimated icon='Coins' size={150} loop/>;
      case 'accepted':
        return <IconAnimated icon='AnimatedCheck' size={150} timer={300} />;
      case 'denied':
        return <IconAnimated icon='Denied' size={150} timer={300} />;
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
      {/* Mock selector for status changes */}
      <div className="flex items-center space-x-2">
        <label htmlFor="status-select" className="font-medium text-[#356E6A]">Mock Status:</label>
        <select
          id="status-select"
          value={status}
          onChange={e => setStatus(e.target.value as TransactionStatus)}
          className="border border-[#356E6A] rounded px-2 py-1 bg-white/60 text-[#356E6A] focus:outline-none"
        >
          <option value="inProgress">In Progress</option>
          <option value="accepted">Accepted</option>
          <option value="denied">Denied</option>
        </select>
      </div>

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