import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Swap from '../../components/Swap/Swap';
import NavBarResponsive from '../../components/WebSwap/NavBarResponsive';
import ConnectWallet from '../../components/WebSwap/ConnectWallet';

const currencies = [
  { flag: 'co', name: 'Pesos' },
  { flag: 'br', name: 'Reales' }
];

const WebSwap: React.FC = () => {
  const [currentCurrency, setCurrentCurrency] = React.useState(0);
  const [isVisible, setIsVisible] = React.useState(true);
  const [isWalletModalOpen, setIsWalletModalOpen] = React.useState(false);
  
  React.useEffect(() => {
    const interval = setInterval(() => {
      // Start fade out
      setIsVisible(false);
      
      // After fade out completes, change currency and fade in
      setTimeout(() => {
        setCurrentCurrency((prev) => (prev + 1) % currencies.length);
        setIsVisible(true);
      }, 300); // Half of the transition duration
    }, 3000); // Slower interval for more gentle feel

    return () => clearInterval(interval);
  }, []);

  const handleWalletConnect = React.useCallback(() => {
    setIsWalletModalOpen(true);
  }, []);

  const handleWalletClose = React.useCallback(() => {
    setIsWalletModalOpen(false);
  }, []);

  const handleWalletSelect = React.useCallback((walletType: 'trust' | 'stellar') => {
    console.log('Wallet selected:', walletType);
    setIsWalletModalOpen(false);
  }, []);

  const handleSwapContinue = React.useCallback((quote_id: string, srcAmount: string, tgtAmount: string) => {
    console.log('Continue clicked:', { quote_id, srcAmount, tgtAmount });
    // Handle the continue action here
  }, []);

  const handleAmountsChange = React.useCallback((srcAmount: string, tgtAmount: string) => {
    console.log('Amounts changed:', { srcAmount, tgtAmount });
    // Handle amount changes here
  }, []);

  return (
    <div 
      className="w-screen min-h-screen md:h-screen md:overflow-hidden"
      style={{
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Desktop background image */}
      <div 
        className="hidden md:block absolute inset-0 z-0"
        style={{
          backgroundImage: 'url(https://storage.googleapis.com/cdn-abroad/bg/36132013403_56c8daad31_3k.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'fixed'
        }}
      />
      {/* Navigation Bar */}
      <div className="relative z-10 bg-green-50 md:bg-transparent">
        <NavBarResponsive onWalletConnect={handleWalletConnect} />
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col md:flex-row relative z-10">
        {/* MOBILE LAYOUT - Full viewport swap, then scrollable content */}
        <div className="md:hidden flex flex-col w-full bg-green-50">
          {/* Swap component - takes full viewport height minus navbar with green background */}
          <div 
            className="flex items-center justify-center px-4" 
            style={{ height: 'calc(100vh - 80px)' }}
          >
            <div className="w-full max-w-md">
              <Swap
                onContinue={handleSwapContinue}
                onAmountsChange={handleAmountsChange}
              />
            </div>
          </div>

          {/* Content below the fold - appears when scrolling down with image background */}
          <div 
            className="flex flex-col min-h-screen"
            style={{
              backgroundImage: 'url(https://storage.googleapis.com/cdn-abroad/bg/36132013403_56c8daad31_3k.jpg)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              backgroundAttachment: 'fixed'
            }}
          >
            {/* Image credits */}
            <div 
              onClick={() => window.open('https://www.flickr.com/photos/pedrosz/36132013403', '_blank')}
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                color: 'white',
                fontSize: '12px',
                fontFamily: 'Airbnb Cereal, Inter, sans-serif',
                padding: '8px 12px',
                borderRadius: '6px',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                cursor: 'pointer',
                transition: 'background-color 0.2s ease, transform 0.1s ease',
                userSelect: 'none',
                margin: '20px',
                textAlign: 'center'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
                e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              Rio Guayabero, Macarena, Colombia. by Pedro Szekely, CC BY-SA 2.0
            </div>

            {/* Animated text */}
            <div 
              className="flex-1 flex items-center justify-center"
              style={{
                color: 'white',
                fontSize: '32px',
                fontFamily: 'Airbnb Cereal, Inter, sans-serif',
                fontWeight: 'bold',
                textShadow: '2px 2px 4px rgba(0, 0, 0, 0.7)',
                lineHeight: '1.2',
                padding: '20px',
                textAlign: 'center'
              }}
            > 
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <span>From</span>
                  <img
                    src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
                    alt="USDC Token"
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%'
                    }}
                  />
                  <span>Stablecoins</span>
                </div>
                <div 
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginTop: '10px',
                    justifyContent: 'center',
                    flexWrap: 'wrap'
                  }}
                >
                  <span>to</span>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      transition: 'opacity 0.6s ease-in-out, transform 0.6s ease-in-out',
                      opacity: isVisible ? 1 : 0,
                      transform: isVisible ? 'translateY(0)' : 'translateY(10px)'
                    }}
                  >
                    <img
                      src={`https://hatscripts.github.io/circle-flags/flags/${currencies[currentCurrency].flag}.svg`}
                      alt={`${currencies[currentCurrency].name} flag`}
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%'
                    }}
                  />
                  <span>{currencies[currentCurrency].name}</span>
                  </div>
                  <span>in seconds</span>
                </div>
              </div>
            </div>

            {/* Image credits */}
            <div 
              onClick={() => window.open('https://www.flickr.com/photos/pedrosz/36132013403', '_blank')}
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                color: 'white',
                fontSize: '12px',
                fontFamily: 'Airbnb Cereal, Inter, sans-serif',
                padding: '8px 12px',
                borderRadius: '6px',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                cursor: 'pointer',
                transition: 'background-color 0.2s ease, transform 0.1s ease',
                userSelect: 'none',
                margin: '20px',
                textAlign: 'center'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
                e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              Rio Guayabero, Macarena, Colombia. by Pedro Szekely, CC BY-SA 2.0
            </div>

            {/* Powered by logo */}
            <div 
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                color: 'white',
                fontSize: '14px',
                fontFamily: 'Airbnb Cereal',
                justifyContent: 'center',
                paddingBottom: '40px'
              }}
            >
              <span>powered by</span>
              <img 
                src="https://storage.googleapis.com/cdn-abroad/Icons/Stellar/SCF_white.svg" 
                alt="Stellar"
                style={{ height: '24px', width: 'auto' }}
              />
            </div>
          </div>
        </div>

        {/* DESKTOP LAYOUT - Two Columns */}
        {/* LEFT COLUMN - Marketing text and attribution */}
        <div 
          className="hidden md:flex w-1/2 flex-col relative"
        >
          {/* Animated text */}
          <div 
            className="absolute left-10 top-1/2 transform -translate-y-1/2 max-w-[700px]"
            style={{
              color: 'white',
              fontSize: '58px',
              fontFamily: 'Airbnb Cereal, Inter, sans-serif',
              fontWeight: 'bold',
              textShadow: '2px 2px 4px rgba(0, 0, 0, 0.7)',
              lineHeight: '1.2'
            }}
          > 
            <div style={{ display: 'flex', alignItems: 'center', gap: '19px' }}>
              <span>From</span>
              <img
                src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
                alt="USDC Token"
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%'
                }}
              />
              <span>Stablecoins</span>
            </div>
            <div 
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '19px',
                marginTop: '10px'
              }}
            >
              <span>to</span>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '19px',
                  minWidth: '200px',
                  transition: 'opacity 0.6s ease-in-out, transform 0.6s ease-in-out',
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? 'translateY(0)' : 'translateY(10px)'
                }}
              >
                <img
                  src={`https://hatscripts.github.io/circle-flags/flags/${currencies[currentCurrency].flag}.svg`}
                  alt={`${currencies[currentCurrency].name} flag`}
                  style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '50%'
                  }}
                />
                <span>{currencies[currentCurrency].name}</span>
              </div>
              <span>in seconds</span>
            </div>
          </div>

          {/* Attribution badge in bottom left */}
          <div 
            onClick={() => window.open('https://www.flickr.com/photos/pedrosz/36132013403', '_blank')}
            className="absolute bottom-5 left-5"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.4)',
              color: 'white',
              fontSize: '12px',
              fontFamily: 'Airbnb Cereal, Inter, sans-serif',
              padding: '8px 12px',
              borderRadius: '6px',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease, transform 0.1s ease',
              userSelect: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            Rio Guayabero, Macarena, Colombia. by Pedro Szekely, CC BY-SA 2.0
          </div>
        </div>

        {/* RIGHT COLUMN - Swap component */}
        <div 
          className="hidden md:flex w-1/2 flex-col justify-center items-center p-10 relative"
        >
          {/* Swap component */}
          <div className="flex-1 flex items-center w-full">
            <Swap
              onContinue={handleSwapContinue}
              onAmountsChange={handleAmountsChange}
              textColor="white"
            />
          </div>

          {/* Powered by logo for desktop only */}
          <div 
            className="absolute bottom-5 right-5 flex items-center gap-3 text-white text-[15px]"
            style={{ fontFamily: 'Airbnb Cereal' }}
          >
            <span>powered by</span>
            <img 
              src="https://storage.googleapis.com/cdn-abroad/Icons/Stellar/SCF_white.svg" 
              alt="Stellar"
              className="h-9 w-auto"
            />
          </div>
        </div>
      </div>

      {/* Wallet Modal - Rendered at top level */}
      <AnimatePresence>
        {isWalletModalOpen && (
          <motion.div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[99999] flex items-center justify-center md:justify-end p-4 md:pr-8"
            onClick={handleWalletClose}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <ConnectWallet 
                onWalletSelect={handleWalletSelect} 
                onClose={handleWalletClose}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default WebSwap;