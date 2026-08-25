import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Button type is required to prevent accidental form submission.
   * - 'button': Generic button (no form action)
   * - 'submit': Submits form when clicked
   * - 'reset': Resets form when clicked
   */
  type: 'button' | 'submit' | 'reset';
}

/**
 * Type-safe button component that enforces explicit type attribute.
 * This prevents common bugs where buttons without type="button" accidentally
 * trigger form submission or other unexpected behavior.
 */
export function Button({ type, ...props }: ButtonProps) {
  return <button type={type} {...props} />;
}
