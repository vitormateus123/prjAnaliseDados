// src/utils/scrollFieldIntoView.ts
//
// O KeyboardAvoidingScreen só empurra o conteúdo pra cima quando o teclado
// abre — ele não sabe QUAL campo está sendo preenchido. Se esse campo
// estiver mais abaixo do que a área que sobrou visível, ele fica atrás do
// teclado e a pessoa precisa rolar manualmente pra enxergar o que está
// digitando. Este helper resolve isso: no onFocus do TextInput, rola a
// lista/scroll até a posição do campo.
import {
  FocusEvent,
  Platform,
  UIManager,
  findNodeHandle,
} from 'react-native';

// Respiro entre o topo do campo e a borda visível do scroll, pra ele não
// ficar colado na borda (ou embaixo de um header sticky).
const EXTRA_OFFSET = 24;

// No Android o teclado ainda está subindo — e o KeyboardAvoidingView ainda
// reajustando a altura da view — no exato instante em que onFocus dispara.
// Medir cedo demais dá coordenadas de antes do reajuste. iOS é mais
// estável, mas um delay pequeno não é perceptível.
const MEASURE_DELAY = Platform.OS === 'android' ? 120 : 50;

interface ScrollableNode {
  scrollTo?: (opts: { y: number; animated: boolean }) => void;
  scrollToOffset?: (opts: { offset: number; animated: boolean }) => void;
}

/**
 * Cria um handler de onFocus que rola o node retornado por `getScrollNode`
 * até o campo que acabou de ser focado.
 *
 * Não depende de uma ref por campo: usa o próprio node nativo do TextInput
 * focado (event.target), então funciona igual em listas com N campos
 * dinâmicos (ex: DynamicFields, formulários gerados a partir de um
 * template) sem precisar criar/gerenciar uma ref pra cada um.
 *
 * `getScrollNode` é uma função (não o node direto) porque em telas com
 * FlatList o ref só existe depois da primeira renderização — lendo via
 * função garante que pegamos sempre o valor atual do ref.
 *
 * Funciona tanto com ScrollView (scrollTo) quanto com FlatList
 * (scrollToOffset) — cada TextInput não precisa saber qual dos dois está
 * por trás.
 */
export function makeFieldFocusHandler(
  getScrollNode: () => ScrollableNode | null,
  extraOffset: number = EXTRA_OFFSET,
) {
  return (event: FocusEvent) => {
    const scrollNode = getScrollNode();
    const scrollHandle = findNodeHandle(scrollNode as unknown as null);
    // event.nativeEvent.target é o node handle do TextInput que disparou o
    // foco — não confundir com event.target, que no React Native aponta
    // pra instância do host component, não pro handle numérico que
    // UIManager.measureLayout espera.
    const inputHandle = event.nativeEvent.target;

    if (!scrollNode || !scrollHandle || !inputHandle) return;

    setTimeout(() => {
      UIManager.measureLayout(
        inputHandle,
        scrollHandle,
        () => {
          // Falha silenciosa: pode acontecer se o campo já foi desmontado
          // (ex: usuário tocou noutro lugar antes do timeout disparar).
        },
        (_x: number, y: number) => {
          const offset = Math.max(y - extraOffset, 0);

          if (scrollNode.scrollTo) {
            scrollNode.scrollTo({ y: offset, animated: true });
          } else if (scrollNode.scrollToOffset) {
            scrollNode.scrollToOffset({ offset, animated: true });
          }
        },
      );
    }, MEASURE_DELAY);
  };
}

export type FieldFocusHandler = ReturnType<typeof makeFieldFocusHandler>;
