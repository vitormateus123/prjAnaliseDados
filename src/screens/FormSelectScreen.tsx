// src/screens/FormSelectScreen.tsx

import React from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MOCK_FORM_TEMPLATES } from '../mock/formTemplates';
import { FormTemplate } from '../types/forms';
import { RootStackParamList } from '../../App';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function FormSelectScreen() {
  const navigation = useNavigation<NavProp>();

  function handleSelect(template: FormTemplate) {
    navigation.navigate('Captura', { formTemplateId: template.id });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Novo Relatório</Text>
        <Text style={styles.subtitle}>Escolha o tipo de formulário</Text>
      </View>
      <FlatList
        data={MOCK_FORM_TEMPLATES}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => handleSelect(item)}
            activeOpacity={0.85}
          >
            <Text style={styles.cardTitle}>{item.name}</Text>
            {item.description && (
              <Text style={styles.cardDesc}>{item.description}</Text>
            )}
            <Text style={styles.cardFields}>
              {item.fields.length} campos
            </Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  header: { padding: 24, paddingBottom: 12 },
  title: { fontSize: 28, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 4 },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: '#e2e8f0',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  cardDesc: { fontSize: 13, color: '#64748b', marginBottom: 8 },
  cardFields: { fontSize: 12, color: '#94a3b8' },
});