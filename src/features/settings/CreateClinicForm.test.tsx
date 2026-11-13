// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const rpc = vi.fn();
const navigate = vi.fn();
const putLocal = vi.fn(async (_clinic: unknown) => {});
const therapistPut = vi.fn(async (_t: unknown) => {});
const addServices = vi.fn(async (_items: unknown) => {});
const listClinics = vi.fn(async (): Promise<unknown[]> => []);
const setActiveClinic = vi.fn(async (_id: string) => {});
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@/app/useActiveClinic', () => ({ setActiveClinic: (id: string) => setActiveClinic(id) }));
vi.mock('@/app/signOut', () => ({ signOutSafely: vi.fn() }));
vi.mock('@/sync/engine', () => ({ syncEngine: { schedule: vi.fn() } }));
vi.mock('@/services', () => ({
  repos: {
    clinics: { putLocal: (c: unknown) => putLocal(c), list: () => listClinics() },
    therapists: { put: (t: unknown) => therapistPut(t) },
  },
  catalogService: { addServices: (i: unknown) => addServices(i) },
}));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', user_metadata: { full_name: 'Dr Priya' } } } }) },
    rpc: (...a: unknown[]) => rpc(...a),
  }),
}));

import { CreateClinicForm } from './CreateClinicForm';

beforeEach(() => {
  rpc.mockReset().mockImplementation(async (_name: string, args: { p_name: string; p_invoice_prefix: string }) => ({
    data: {
      id: 'c1',
      name: args.p_name,
      email: null,
      phone: null,
      address: null,
      invoice_prefix: args.p_invoice_prefix,
      fy_start_month: 4,
      onboarding_completed_at: '2026-11-13T00:00:00Z',
      updated_at: '2026-11-13T00:00:00Z',
    },
    error: null,
  }));
  navigate.mockClear();
  putLocal.mockClear();
  therapistPut.mockClear();
  addServices.mockClear();
  setActiveClinic.mockClear();
  listClinics.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

const nameBox = () => screen.getByLabelText('Practice or clinic name');
async function toServices(name = 'Apex Physio') {
  fireEvent.change(nameBox(), { target: { value: name } });
  await waitFor(() => expect(screen.getByLabelText('Your name')).toHaveValue('Dr Priya'));
  fireEvent.click(screen.getByRole('button', { name: 'Next: your services' }));
  await screen.findByText('Do your patients pay you?');
}
const priceBoxes = () => screen.getAllByLabelText('Price in rupees') as HTMLInputElement[];
const startBtn = () => screen.getByRole('button', { name: 'Start using Thera.Net' });

describe('CreateClinicForm screen 1', () => {
  it('renders only the four fields and Next', () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    expect(nameBox()).toHaveValue('');
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('I treat patients myself')).toBeChecked();
    expect(screen.getByLabelText('At a clinic or hospital')).toBeChecked();
    expect(screen.getByLabelText('Home visits')).not.toBeChecked();
    expect(screen.queryByLabelText(/address/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: your services' })).toBeDisabled();
  });

  it('pre-fills your name from the account', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Your name')).toHaveValue('Dr Priya'));
  });

  it('shows the derived code line', () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    fireEvent.change(nameBox(), { target: { value: 'Apex Physio' } });
    expect(screen.getByText(/Bills and patient IDs start with AP/)).toBeInTheDocument();
  });

  it('blocks Next with a one-letter code', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    fireEvent.change(nameBox(), { target: { value: 'Apex Physio' } });
    await waitFor(() => expect(screen.getByLabelText('Your name')).toHaveValue('Dr Priya'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Clinic code'), { target: { value: 'A' } });
    expect(screen.getByRole('button', { name: 'Next: your services' })).toBeDisabled();
    expect(screen.getByText('2 to 6 letters or numbers')).toBeInTheDocument();
  });

  it('warns, without blocking, when another clinic uses the same code', async () => {
    listClinics.mockResolvedValue([{ id: 'x', name: 'Apex Rehab', invoicePrefix: 'AP' }]);
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    fireEvent.change(nameBox(), { target: { value: 'Apex Physio' } });
    expect(await screen.findByText('Your other clinic Apex Rehab also uses AP.')).toBeInTheDocument();
  });

  it('unticking both locations blocks Next', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    fireEvent.change(nameBox(), { target: { value: 'Apex Physio' } });
    await waitFor(() => expect(screen.getByLabelText('Your name')).toHaveValue('Dr Priya'));
    fireEvent.click(screen.getByLabelText('At a clinic or hospital'));
    expect(screen.getByText('Choose at least one place')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: your services' })).toBeDisabled();
  });
});

describe('CreateClinicForm screen 2', () => {
  it('shows the services screen with blank prices and Start disabled', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    await toServices();
    expect(priceBoxes().length).toBeGreaterThan(0);
    for (const b of priceBoxes()) expect(b).toHaveDisplayValue('');
    expect(startBtn()).toBeDisabled();
    expect(screen.getByText(/Price at least one service to start logging visits\./)).toBeInTheDocument();
  });

  it('Start stays disabled with only 0 prices', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    await toServices();
    fireEvent.change(priceBoxes()[0], { target: { value: '0' } });
    expect(startBtn()).toBeDisabled();
  });

  it('nothing is created before Start', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    await toServices();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('Back keeps screen 1 values', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Home visits'));
    fireEvent.click(screen.getByLabelText('I treat patients myself'));
    await toServices();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(nameBox()).toHaveValue('Apex Physio');
    expect(screen.getByLabelText('Home visits')).toBeChecked();
    expect(screen.getByLabelText('I treat patients myself')).not.toBeChecked();
  });

  it('No path: no price boxes and Start enabled', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    await toServices();
    fireEvent.click(screen.getByLabelText('No: I don\'t bill, or the hospital bills'));
    expect(screen.queryAllByLabelText('Price in rupees')).toHaveLength(0);
    expect(startBtn()).toBeEnabled();
    expect(screen.getByText('Name the services you give. No prices needed.')).toBeInTheDocument();
  });

  it('switching No to Yes keeps names with blank prices', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    await toServices();
    fireEvent.click(screen.getByLabelText('No: I don\'t bill, or the hospital bills'));
    fireEvent.change(screen.getAllByLabelText('Service name')[0], { target: { value: 'My own service' } });
    fireEvent.click(screen.getByLabelText('Yes, I charge patients'));
    expect(screen.getAllByLabelText('Service name')[0]).toHaveValue('My own service');
    for (const b of priceBoxes()) expect(b).toHaveDisplayValue('');
  });

  it('duplicate service names block Start', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    await toServices();
    fireEvent.change(priceBoxes()[0], { target: { value: '500' } });
    fireEvent.change(priceBoxes()[1], { target: { value: '300' } });
    fireEvent.change(screen.getAllByLabelText('Service name')[1], { target: { value: 'initial consultation' } });
    expect(startBtn()).toBeDisabled();
    expect(screen.getByText(/is listed twice\. Give each service its own name\./)).toBeInTheDocument();
  });
});

describe('CreateClinicForm submit', () => {
  async function priceOneAndStart() {
    await toServices();
    fireEvent.change(priceBoxes()[2], { target: { value: '800' } });
    expect(startBtn()).toBeEnabled();
    fireEvent.click(startBtn());
    await waitFor(() => expect(rpc).toHaveBeenCalled());
  }

  it('calls the RPC with the new parameters', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    await priceOneAndStart();
    expect(rpc).toHaveBeenCalledWith(
      'create_clinic_with_admin',
      expect.objectContaining({
        p_name: 'Apex Physio',
        p_invoice_prefix: 'AP',
        p_walk_in_mrno_prefix: 'AP',
        p_care_locations: ['clinic'],
        p_complete_onboarding: true,
        p_charges_patients: true,
      }),
    );
  });

  it('writes the owner therapist and only the priced services locally', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    await priceOneAndStart();
    await waitFor(() => expect(addServices).toHaveBeenCalled());
    expect(therapistPut).toHaveBeenCalledTimes(1);
    expect(therapistPut.mock.calls[0][0]).toMatchObject({ userId: 'u1', name: 'Dr Priya', active: true, clinicId: 'c1' });
    expect((therapistPut.mock.calls[0][0] as { profileConfirmedAt?: string }).profileConfirmedAt).toBeTruthy();
    const items = addServices.mock.calls[0][0] as { basePricePaise: number }[];
    expect(items).toHaveLength(1);
    expect(items[0].basePricePaise).toBe(80000);
  });

  it('No path saves services at 0 and stores the answer', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    await toServices();
    fireEvent.click(screen.getByLabelText('No: I don\'t bill, or the hospital bills'));
    fireEvent.click(startBtn());
    await waitFor(() => expect(addServices).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_charges_patients: false });
    const items = addServices.mock.calls[0][0] as { basePricePaise: number }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.basePricePaise === 0)).toBe(true);
  });

  it('skips the therapist when unticked', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('I treat patients myself'));
    await priceOneAndStart();
    await waitFor(() => expect(addServices).toHaveBeenCalled());
    expect(therapistPut).not.toHaveBeenCalled();
  });

  it('page variant lands on /workspace', async () => {
    const onSuccess = vi.fn();
    render(<CreateClinicForm onSuccess={onSuccess} />);
    await priceOneAndStart();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/workspace' }));
    expect(setActiveClinic).toHaveBeenCalledWith('c1');
  });

  it('dialog variant does not navigate', async () => {
    const onSuccess = vi.fn();
    render(<CreateClinicForm onSuccess={onSuccess} variant="dialog" />);
    await priceOneAndStart();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('Home visits ticked sends both locations', async () => {
    render(<CreateClinicForm onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Home visits'));
    await priceOneAndStart();
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_care_locations: ['clinic', 'home'] });
  });
});
