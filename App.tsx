// App.tsx — adicionar FormSelect e Captura com parâmetro

export type RootStackParamList = {
  Principal: { screen?: string } | undefined;
  FormSelect: undefined;                             // NOVO
  Captura: { formTemplateId: string };               // ALTERADO: agora recebe o template
  Revisao: { reportId: string; extractionFailed: boolean };
};

// Adicionar no Stack.Navigator:
// <Stack.Screen name="FormSelect" component={FormSelectScreen} options={{ title: 'Novo Relatório' }} />
// <Stack.Screen name="Captura" component={CapturaScreen} options={{ title: 'Captura' }} />