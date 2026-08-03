import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('current_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [users, setUsers] = useState(() => {
    const saved = localStorage.getItem('app_users');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('app_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('current_user', JSON.stringify(user));
      const stored = localStorage.getItem('app_password') || sessionStorage.getItem('app_password') || 'freshuser-apppass-2026';
      sessionStorage.setItem('app_password', stored);
      localStorage.setItem('app_password', stored);
    } else {
      localStorage.removeItem('current_user');
      sessionStorage.removeItem('app_password');
    }
  }, [user]);

  const login = (username, password) => {
    const apiPass = localStorage.getItem('app_password') || sessionStorage.getItem('app_password') || 'freshuser-apppass-2026';
    // First run — no accounts exist yet, so this becomes the admin account.
    if (users.length === 0) {
      const newUser = { id: Date.now(), username, role: 'admin', password };
      setUsers([newUser]);
      setUser(newUser);
      localStorage.setItem('app_password', apiPass);
      sessionStorage.setItem('app_password', apiPass);
      return { success: true };
    }
    const found = users.find(u => u.username === username && u.password === password);
    if (found) {
      setUser(found);
      localStorage.setItem('app_password', apiPass);
      sessionStorage.setItem('app_password', apiPass);
      return { success: true };
    }
    return { success: false, message: 'Invalid username or password' };
  };

  const logout = () => {
    setUser(null);
  };

  const addUser = (newUser) => {
    setUsers(prev => [...prev, { ...newUser, id: Date.now() }]);
  };

  const deleteUser = (id) => {
    if (id === user?.id) return { success: false, message: 'Cannot delete yourself' };
    setUsers(prev => prev.filter(u => u.id !== id));
    return { success: true };
  };

  const canAction = (requiredRole) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (requiredRole === 'operator' && user.role === 'operator') return true;
    return user.role === requiredRole;
  };

  const value = {
    user,
    users,
    login,
    logout,
    addUser,
    deleteUser,
    canAction,
    isAdmin: user?.role === 'admin',
    isViewer: user?.role === 'viewer'
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
