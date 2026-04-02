<script lang="ts">
    import SimpleCodeEditorComponent from "./simpleCodeEditor/simpleCodeEditor.svelte";

    interface Props {
        value?: string;
        language?: string;
    }

    let { value = "", language = "plaintext" }: Props = $props();
</script>

<SimpleCodeEditorComponent code={value} {language} />
