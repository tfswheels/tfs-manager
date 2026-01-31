import React, { useState, useEffect } from 'react';
import {
  Modal,
  TextField,
  FormLayout,
  Text,
  Banner,
} from '@shopify/polaris';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const SHOP_ID = 1; // Default shop ID

/**
 * Staff Registration Component
 *
 * Automatically registers staff members when they first access the app.
 * Uses localStorage to track if user has been registered.
 *
 * This solves the problem of Shopify's staffMembers API being deprecated
 * and not accessible to custom apps.
 */
export default function StaffRegistration({ children }) {
  const [showModal, setShowModal] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    checkStaffRegistration();
  }, []);

  const checkStaffRegistration = () => {
    // Check if user has been registered
    const staffId = localStorage.getItem('tfs_staff_id');
    const staffEmail = localStorage.getItem('tfs_staff_email');

    if (!staffId || !staffEmail) {
      // User not registered - show modal
      setTimeout(() => setShowModal(true), 1000); // Small delay for better UX
    } else {
      // User already registered - verify they still exist in database
      verifyStaffExists(staffId, staffEmail);
    }
  };

  const verifyStaffExists = async (staffId, email) => {
    try {
      const response = await axios.get(`${API_URL}/api/staff/${SHOP_ID}`);
      if (response.data.success) {
        const staff = response.data.data.find(s => s.id === parseInt(staffId) && s.email === email);
        if (!staff) {
          // Staff record doesn't exist anymore - clear and re-register
          localStorage.removeItem('tfs_staff_id');
          localStorage.removeItem('tfs_staff_email');
          setShowModal(true);
        }
      }
    } catch (err) {
      console.error('Error verifying staff:', err);
      // Don't show modal on error - user can continue using app
    }
  };

  const handleRegister = async () => {
    // Validation
    if (!firstName.trim() || !email.trim()) {
      setError('Please enter your name and email');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const fullName = lastName.trim()
        ? `${firstName.trim()} ${lastName.trim()}`
        : firstName.trim();

      // Register staff member
      const response = await axios.post(`${API_URL}/api/staff/${SHOP_ID}/register`, {
        email: email.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        full_name: fullName,
        role: 'staff', // Default role
      });

      if (response.data.success) {
        const staffMember = response.data.data;

        // Store in localStorage
        localStorage.setItem('tfs_staff_id', String(staffMember.id));
        localStorage.setItem('tfs_staff_email', staffMember.email);
        localStorage.setItem('tfs_staff_name', staffMember.full_name);

        console.log('✅ Staff registered:', staffMember.full_name);

        // Close modal
        setShowModal(false);
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError(err.response?.data?.error || 'Failed to register. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {showModal && (
        <Modal
          open={showModal}
          title="Welcome to TFS Manager!"
          onClose={() => {}} // Prevent closing - registration is required
          primaryAction={{
            content: 'Register',
            onAction: handleRegister,
            loading: loading,
          }}
        >
          <Modal.Section>
            <FormLayout>
              <Banner tone="info">
                <p>
                  Please tell us who you are so we can track your ticket activity
                  and enable features like staff assignment.
                </p>
              </Banner>

              {error && (
                <Banner tone="critical">
                  <p>{error}</p>
                </Banner>
              )}

              <Text variant="headingMd" as="h2">Your Information</Text>

              <TextField
                label="First Name"
                value={firstName}
                onChange={setFirstName}
                autoComplete="given-name"
                placeholder="John"
                requiredIndicator
              />

              <TextField
                label="Last Name"
                value={lastName}
                onChange={setLastName}
                autoComplete="family-name"
                placeholder="Doe"
              />

              <TextField
                label="Email Address"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                placeholder="john@tfswheels.com"
                helpText="Use your work email that you'll use to reply to tickets"
                requiredIndicator
              />

              <Banner tone="warning">
                <p>
                  <strong>Important:</strong> Use the same email address you'll use to send
                  emails to customers. This helps us track which staff member is handling each ticket.
                </p>
              </Banner>
            </FormLayout>
          </Modal.Section>
        </Modal>
      )}

      {children}
    </>
  );
}
