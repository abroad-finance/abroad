import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute: React.FC = () => {
  const { user, initializing } = useAuth();

  if (initializing) {
    return null; // wait for auth initialization before deciding route
  }

  if (!user) {
    // User not logged in, redirect to login page
    return <Navigate to="/" replace />;
  }

  // User is logged in, render the requested component
  return <Outlet />;
};

export default ProtectedRoute;
