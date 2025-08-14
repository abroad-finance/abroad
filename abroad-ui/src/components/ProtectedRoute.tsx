import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useWalletAuth } from '../context/WalletAuthContext';

const ProtectedRoute: React.FC = () => {
  const { token } = useWalletAuth();


  if (!token) {
    // User not logged in, redirect to login page
    return <Navigate to="/" replace />;
  }

  // User is logged in, render the requested component
  return <Outlet />;
};

export default ProtectedRoute;
