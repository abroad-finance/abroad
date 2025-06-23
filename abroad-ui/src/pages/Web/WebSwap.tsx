import React from 'react';
import Swap from '../../components/Swap/Swap';

const WebSwap: React.FC = () => {
  const [currentCurrency, setCurrentCurrency] = React.useState(0);
  const [isVisible, setIsVisible] = React.useState(true);
  
  const currencies = [
    { flag: 'co', name: 'Pesos' },
    { flag: 'br', name: 'Reales' }
  ];

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
  }, [currencies.length]);

  return (
    <div 
      style={{
        width: '100vw',
        height: '100vh',
        backgroundImage: 'url(https://storage.googleapis.com/cdn-abroad/bg/36132013403_56c8daad31_3k.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        display: 'flex'
      }}
    >
      {/* LEFT COLUMN - Marketing text and attribution */}
      <div 
        style={{
          width: '50%',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative'
        }}
      >
        {/* Animated text */}
        <div 
          style={{
            position: 'absolute',
            left: '40px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'white',
            fontSize: '58px',
            fontFamily: 'Airbnb Cereal, Inter, sans-serif',
            fontWeight: 'bold',
            textShadow: '2px 2px 4px rgba(0, 0, 0, 0.7)',
            maxWidth: '700px',
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
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '20px',
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

      {/* RIGHT COLUMN - Swap component and Stellar logo */}
      <div 
        style={{
          width: '50%',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '40px',
          position: 'relative'
        }}
      >
        {/* Swap component in the center */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', width: '100%' }}>
          <Swap
            onContinue={(quote_id: string, srcAmount: string, tgtAmount: string) => {
              console.log('Continue clicked:', { quote_id, srcAmount, tgtAmount });
              // Handle the continue action here
            }}
            onAmountsChange={(srcAmount: string, tgtAmount: string) => {
              console.log('Amounts changed:', { srcAmount, tgtAmount });
              // Handle amount changes here
            }}
          />
        </div>

        {/* Powered by logo in bottom right */}
        <div 
          style={{
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: 'white',
            fontSize: '18px',
            fontFamily: 'Airbnb Cereal'
          }}
        >
          <span>powered by</span>
          <img 
            src="https://storage.googleapis.com/cdn-abroad/Icons/Stellar/SCF_white.svg" 
            alt="Stellar"
            style={{ height: '36px', width: 'auto' }}
          />
        </div>
      </div>
    </div>
  );
};

export default WebSwap;