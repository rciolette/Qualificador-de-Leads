import { useEffect, useRef, useState } from 'react'

/**
 * Segura um valor por `ms` antes de deixá-lo passar.
 *
 * O funil recalcula a cada mudança de etapa, e mexer num slider ou digitar num
 * campo de valor dispara uma mudança por tecla. Sem isto, arrastar "mínimo de
 * aulas" de 0 a 10 enfileirava dez recálculos, e o nono chegava depois do
 * décimo — o número na tela acabava sendo de um estado que o usuário já
 * abandonou.
 *
 * 250 ms porque é o intervalo em que uma pausa de digitação vira intenção: mais
 * curto e ainda se recalcula no meio da palavra, mais longo e a tela parece
 * travada.
 */
export function useDebounce<T>(valor: T, ms = 250): T {
  const [atrasado, setAtrasado] = useState(valor)

  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])

  return atrasado
}

/**
 * O valor atrasado, mais se ele ainda está alcançando o valor atual.
 *
 * Saber que o número na tela está velho é tão importante quanto o número: sem
 * isso o botão "Ver os 2.364" fica clicável enquanto 2.364 já é resposta de uma
 * pergunta anterior, e a pessoa avança com a lista errada.
 *
 * A comparação é por JSON porque o que se compara aqui são as etapas e a
 * config — objetos remontados a cada render, em que igualdade por referência
 * daria sempre "diferente".
 */
export function useDebounceComEstado<T>(valor: T, ms = 250): [T, boolean] {
  const atrasado = useDebounce(valor, ms)
  const serializado = useRef('')
  serializado.current = JSON.stringify(valor)
  return [atrasado, serializado.current !== JSON.stringify(atrasado)]
}
