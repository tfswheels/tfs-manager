import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShoppingCart, Package, Mail, Inbox, Settings, Menu, X } from 'lucide-react';

function Layout({ children }) {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navigation = [
    { name: 'Orders', href: '/', icon: ShoppingCart },
    { name: 'Products & Inventory', href: '/products', icon: Package },
    { name: 'Customer Emails', href: '/emails', icon: Inbox },
    { name: 'Email Templates', href: '/email', icon: Mail },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  const isActive = (href) => {
    if (href === '/') return location.pathname === '/';
    // Exact match or starts with href followed by a slash (prevents /email matching /emails)
    return location.pathname === href || location.pathname.startsWith(href + '/');
  };

  return (
    <div className="min-h-screen flex">
      {/* Mobile Menu Button */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="mobile-menu-button"
        aria-label="Toggle menu"
      >
        {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

      {/* Mobile Overlay */}
      <div
        className={`mobile-overlay ${mobileMenuOpen ? 'active' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="flex items-center gap-2">
            <Package className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">TFS Manager</h1>
              <p className="text-xs text-gray-500">Admin Portal</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);

            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`nav-item ${active ? 'active' : ''}`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <div className="content-wrapper">
          {children}
        </div>
      </main>
    </div>
  );
}

export default Layout;
