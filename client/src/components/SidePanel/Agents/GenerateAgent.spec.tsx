import { useForm, FormProvider } from 'react-hook-form';
import { fireEvent, render, screen } from '@testing-library/react';
import type { UseFormReturn } from 'react-hook-form';
import type { AgentForm } from '~/common';
import GenerateAgent from './GenerateAgent';

const mockShowToast = jest.fn();
const draft = {
  name: '财报助手',
  description: '解读财报',
  instructions: '你是一名财报分析师。',
  category: 'finance',
  conversation_starters: ['分析财报'],
};
const mockMutate = jest.fn((_params, options) => options.onSuccess({ draft }));

jest.mock('~/data-provider', () => ({
  useGenerateAgentMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  return { ...actual, useToastContext: () => ({ showToast: mockShowToast }) };
});

let methods: UseFormReturn<AgentForm>;

function Harness() {
  methods = useForm<AgentForm>({
    defaultValues: {
      id: '',
      provider: 'Fullon',
      model: 'deepseek-v4-pro',
      name: '',
      description: '',
      instructions: '',
      instructionsSource: 'inline',
      instructionsPrompt: null,
      model_parameters: {},
      conversation_starters: [],
      category: '',
    },
  });
  return (
    <FormProvider {...methods}>
      <GenerateAgent />
    </FormProvider>
  );
}

beforeEach(() => {
  mockShowToast.mockClear();
  mockMutate.mockClear();
});

test('fills the form with the generated draft after review', () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('com_ui_ai_agent_prompt_label'), {
    target: { value: '创建一个财报分析助手' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_ai_agent_generate' }));

  expect(mockMutate).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: '创建一个财报分析助手',
      provider: 'Fullon',
      model: 'deepseek-v4-pro',
    }),
    expect.any(Object),
  );
  expect(methods.getValues('name')).toBe('财报助手');
  expect(methods.getValues('instructions')).toBe('你是一名财报分析师。');
  expect(methods.getValues('conversation_starters')).toEqual(['分析财报']);
  expect(mockShowToast).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'com_ui_ai_agent_generated', status: 'success' }),
  );
});
