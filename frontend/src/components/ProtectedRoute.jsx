import React from 'react';
import { Navigate } from 'react-router-dom';
import { getToken, getUser } from '../utils/api';

export default function ProtectedRoute({ children, allowedRole }) {
  const token = getToken();
  const user = getUser();

  if (!token || !user) {
    return <Navigate to="/" replace />;
  }

  if (allowedRole && String(user.role).toLowerCase() !== String(allowedRole).toLowerCase()) {
    // Redirect to the appropriate dashboard
    return <Navigate to={String(user.role).toLowerCase() === 'teacher' ? '/teacher' : '/student'} replace />;
  }

  return children;
}
