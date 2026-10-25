import React from 'react';
import { useNavigate } from 'react-router-dom';
import { clearAuth, getUser } from '../utils/api';
import { LogOut, User } from 'lucide-react';

export default function Navbar() {
  const navigate = useNavigate();
  const user = getUser();

  const handleLogout = () => {
    clearAuth();
    navigate('/');
  };

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <div className="nav-brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <div className="nav-brand-logo">🎯</div>
          <span>AttendX</span>
        </div>

        {user && (
          <div className="nav-user">
            <div className="user-profile">
              <div className="user-avatar">
                {user.name ? user.name[0].toUpperCase() : <User size={16} />}
              </div>
              <div className="user-info-text">
                <span className="user-name">{user.name}</span>
                <span className="user-role-label">
                  <span className={`badge ${user.role === 'teacher' ? 'badge-primary' : 'badge-info'}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>
                    {user.role}
                  </span>
                </span>
              </div>
            </div>

            <button 
              onClick={handleLogout}
              className="btn btn-outline btn-sm"
              title="Sign Out"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
